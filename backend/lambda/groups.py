"""Groups and the shared calendar, stored in one DynamoDB table.

Keys:
  pk=GROUP#<id>  sk=META              name, mode, inviteCode, eventId, ownerId
  pk=GROUP#<id>  sk=MEMBER#<id>       displayName, secretHash, busy, busyUpdatedAt
  pk=GROUP#<id>  sk=ITEM#<id>         kind, sessionId, title, start, end, location, createdBy, going, assignee
  pk=INVITE#<code> sk=INVITE          groupId

Members prove who they are with a random secret we hand out on create/join (stored hashed).
We never see or store anyone's AWS Events token. Data expires a few weeks after re:Invent.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from schedule_math import free_slots, split_sessions

TABLE = os.environ.get("TABLE_NAME", "hallway")
EXPIRES_AT = int(os.environ.get("EXPIRES_AT", "1767225600"))  # 2026-01-01 default, set by CDK
MAX_MEMBERS = 50
MAX_ITEMS = 300
MAX_BUSY = 300
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I

_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(TABLE)
    return _table


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------- helpers ----------


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _id(n: int = 10) -> str:
    return secrets.token_urlsafe(n)[:n].replace("-", "x").replace("_", "y")


def _code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


def _num(v: Any) -> int:
    return int(v) if isinstance(v, (int, Decimal)) else int(float(v))


def _text(v: Any, n: int, field: str, required: bool = True) -> str | None:
    s = str(v or "").strip()
    if not s:
        if required:
            raise HttpError(400, f"{field} is required")
        return None
    return s[:n]


def _interval(start: Any, end: Any) -> tuple[int, int]:
    try:
        s, e = _num(start), _num(end)
    except (TypeError, ValueError):
        raise HttpError(400, "start and end must be epoch milliseconds")
    if e <= s or e - s > 24 * 3600_000:
        raise HttpError(400, "end must be after start, within one day")
    return s, e


def _pk(group_id: str) -> str:
    return f"GROUP#{group_id}"


def _query(group_id: str) -> list[dict]:
    items, kwargs = [], {"KeyConditionExpression": Key("pk").eq(_pk(group_id))}
    while True:
        r = table().query(**kwargs)
        items += r["Items"]
        if "LastEvaluatedKey" not in r:
            return items
        kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def _public_group(meta: dict) -> dict:
    return {
        "groupId": meta["pk"].split("#", 1)[1],
        "name": meta["name"],
        "mode": meta["mode"],
        "inviteCode": meta["inviteCode"],
        "eventId": meta.get("eventId", ""),
    }


def _public_item(it: dict) -> dict:
    out = {
        "itemId": it["sk"].split("#", 1)[1],
        "kind": it["kind"],
        "title": it["title"],
        "start": _num(it["start"]),
        "end": _num(it["end"]),
        "createdBy": it["createdBy"],
        "going": list(it.get("going") or []),
    }
    for k in ("sessionId", "location", "note", "assignee"):
        if it.get(k):
            out[k] = it[k]
    return out


def authenticate(group_id: str, headers: dict[str, str]) -> str:
    member_id = headers.get("x-member-id", "")
    secret = headers.get("x-member-secret", "")
    if not member_id or not secret:
        raise HttpError(401, "Missing member credentials")
    r = table().get_item(Key={"pk": _pk(group_id), "sk": f"MEMBER#{member_id}"}).get("Item")
    if not r or not hmac.compare_digest(r["secretHash"], _hash(secret)):
        raise HttpError(403, "Not a member of this group")
    return member_id


def _new_member(group_id: str, display_name: str) -> tuple[str, str]:
    member_id, secret = _id(10), secrets.token_urlsafe(32)
    table().put_item(
        Item={
            "pk": _pk(group_id),
            "sk": f"MEMBER#{member_id}",
            "displayName": display_name,
            "secretHash": _hash(secret),
            "busy": [],
            "joinedAt": int(time.time() * 1000),
            "expiresAt": EXPIRES_AT,
        }
    )
    return member_id, secret


def _meta(rows: list[dict]) -> dict:
    meta = next((r for r in rows if r["sk"] == "META"), None)
    if not meta:
        raise HttpError(404, "Group not found")
    return meta


def _member_ids(rows: list[dict]) -> set[str]:
    return {r["sk"].split("#", 1)[1] for r in rows if r["sk"].startswith("MEMBER#")}


def _owner_id(meta: dict, rows: list[dict]) -> str:
    """The owner on record, or if they are gone (or the group predates owners), the longest-standing member."""
    if meta.get("ownerId") in _member_ids(rows):
        return meta["ownerId"]
    members = [r for r in rows if r["sk"].startswith("MEMBER#")]
    first = min(members, key=lambda r: _num(r.get("joinedAt", 0)), default=None)
    return first["sk"].split("#", 1)[1] if first else ""


def _require_owner(group_id: str, me: str) -> tuple[list[dict], dict]:
    rows = _query(group_id)
    meta = _meta(rows)
    if _owner_id(meta, rows) != me:
        raise HttpError(403, "Only the group owner can do that")
    return rows, meta


def _scrub_member(rows: list[dict], member_id: str) -> None:
    """Takes a departed member out of every session's "I'm in" list and team assignment."""
    for r in rows:
        if not r["sk"].startswith("ITEM#"):
            continue
        key = {"pk": r["pk"], "sk": r["sk"]}
        going = list(r.get("going") or [])
        if member_id in going:
            table().update_item(
                Key=key,
                UpdateExpression="SET going = :g",
                ExpressionAttributeValues={":g": [m for m in going if m != member_id]},
            )
        if r.get("assignee") == member_id:
            table().update_item(Key=key, UpdateExpression="REMOVE assignee")


def _delete_group(rows: list[dict], meta: dict) -> None:
    """Removes every row of the group and its invite code."""
    with table().batch_writer() as batch:
        for r in rows:
            batch.delete_item(Key={"pk": r["pk"], "sk": r["sk"]})
    table().delete_item(Key={"pk": f"INVITE#{meta['inviteCode']}", "sk": "INVITE"})


# ---------- operations ----------


def create_group(body: dict) -> dict:
    name = _text(body.get("name"), 80, "name")
    display = _text(body.get("displayName"), 40, "displayName")
    mode = body.get("mode", "squad")
    if mode not in ("squad", "team"):
        raise HttpError(400, "mode must be squad or team")
    event_id = _text(body.get("eventId"), 128, "eventId", required=False) or ""
    group_id = _id(12)

    # Reserve a unique invite code.
    for _ in range(5):
        code = _code()
        try:
            table().put_item(
                Item={"pk": f"INVITE#{code}", "sk": "INVITE", "groupId": group_id, "expiresAt": EXPIRES_AT},
                ConditionExpression="attribute_not_exists(pk)",
            )
            break
        except table().meta.client.exceptions.ConditionalCheckFailedException:
            continue
    else:
        raise HttpError(500, "Could not create an invite code")

    member_id, secret = _new_member(group_id, display)
    meta = {
        "pk": _pk(group_id),
        "sk": "META",
        "name": name,
        "mode": mode,
        "inviteCode": code,
        "eventId": event_id,
        "ownerId": member_id,  # whoever creates the group owns it
        "createdAt": int(time.time() * 1000),
        "expiresAt": EXPIRES_AT,
    }
    table().put_item(Item=meta)
    return {"group": _public_group(meta), "memberId": member_id, "secret": secret}


def join_group(body: dict) -> dict:
    code = _text(body.get("inviteCode"), 16, "inviteCode").upper()
    display = _text(body.get("displayName"), 40, "displayName")
    inv = table().get_item(Key={"pk": f"INVITE#{code}", "sk": "INVITE"}).get("Item")
    if not inv:
        raise HttpError(404, "Invite code not found")
    group_id = inv["groupId"]
    rows = _query(group_id)
    meta = next((r for r in rows if r["sk"] == "META"), None)
    if not meta:
        raise HttpError(404, "Group not found")
    members = [r for r in rows if r["sk"].startswith("MEMBER#")]
    if len(members) >= MAX_MEMBERS:
        raise HttpError(409, "This group is full")
    if display.strip().lower() in {str(r["displayName"]).strip().lower() for r in members}:
        raise HttpError(409, "Someone in this group already uses that name. Pick another one.")
    member_id, secret = _new_member(group_id, display)
    return {"group": _public_group(meta), "memberId": member_id, "secret": secret}


def get_group(group_id: str, me: str) -> dict:
    rows = _query(group_id)
    meta = next((r for r in rows if r["sk"] == "META"), None)
    if not meta:
        raise HttpError(404, "Group not found")
    members = [
        {
            "memberId": r["sk"].split("#", 1)[1],
            "displayName": r["displayName"],
            **({"busyUpdatedAt": _num(r["busyUpdatedAt"])} if r.get("busyUpdatedAt") else {}),
        }
        for r in rows
        if r["sk"].startswith("MEMBER#")
    ]
    items = [_public_item(r) for r in rows if r["sk"].startswith("ITEM#")]
    # Busy slots are never returned: other members only see the combined free time.
    return {
        "group": _public_group(meta),
        "members": members,
        "items": items,
        "me": me,
        "ownerId": _owner_id(meta, rows),
    }


def add_item(group_id: str, me: str, body: dict) -> dict:
    kind = body.get("kind")
    if kind not in ("session", "meetup"):
        raise HttpError(400, "kind must be session or meetup")
    start, end = _interval(body.get("start"), body.get("end"))
    rows = _query(group_id)
    items = [r for r in rows if r["sk"].startswith("ITEM#")]
    if len(items) >= MAX_ITEMS:
        raise HttpError(409, "The group calendar is full")
    session_id = _text(body.get("sessionId"), 128, "sessionId", required=(kind == "session"))
    if session_id and any(r.get("sessionId") == session_id for r in items):
        raise HttpError(409, "That session is already on the group calendar")

    item = {
        "pk": _pk(group_id),
        "sk": f"ITEM#{_id(10)}",
        "kind": kind,
        "title": _text(body.get("title"), 200, "title"),
        "start": start,
        "end": end,
        "createdBy": me,
        # Whoever proposes a session or meetup is going to it.
        "going": [me],
        "expiresAt": EXPIRES_AT,
    }
    for k, n in (("location", 255), ("note", 500)):
        v = _text(body.get(k), n, k, required=False)
        if v:
            item[k] = v
    if session_id:
        item["sessionId"] = session_id
    table().put_item(Item=item)
    return _public_item(item)


def remove_item(group_id: str, me: str, item_id: str) -> dict:
    key = {"pk": _pk(group_id), "sk": f"ITEM#{item_id}"}
    it = table().get_item(Key=key).get("Item")
    if not it:
        return {}  # already gone
    if it["createdBy"] != me:
        rows = _query(group_id)
        if _owner_id(_meta(rows), rows) != me:
            raise HttpError(403, "Only the person who added it, or the group owner, can remove it")
    table().delete_item(Key=key)
    return {}


def set_rsvp(group_id: str, me: str, item_id: str, body: dict) -> dict:
    key = {"pk": _pk(group_id), "sk": f"ITEM#{item_id}"}
    it = table().get_item(Key=key).get("Item")
    if not it:
        raise HttpError(404, "Item not found")
    going = [m for m in (it.get("going") or []) if m != me]
    if body.get("going"):
        going.append(me)
    r = table().update_item(
        Key=key,
        UpdateExpression="SET going = :g",
        ExpressionAttributeValues={":g": going},
        ReturnValues="ALL_NEW",
    )
    return _public_item(r["Attributes"])


def set_busy(group_id: str, me: str, body: dict) -> dict:
    slots = body.get("slots")
    if not isinstance(slots, list) or len(slots) > MAX_BUSY:
        raise HttpError(400, f"slots must be a list of at most {MAX_BUSY}")
    clean = [list(_interval(s.get("start"), s.get("end"))) for s in slots if isinstance(s, dict)]
    table().update_item(
        Key={"pk": _pk(group_id), "sk": f"MEMBER#{me}"},
        UpdateExpression="SET busy = :b, busyUpdatedAt = :t",
        ExpressionAttributeValues={":b": clean, ":t": int(time.time() * 1000)},
    )
    return {"count": len(clean)}


def _busy_map(rows: list[dict]) -> tuple[dict[str, list[tuple[int, int]]], list[str]]:
    busy, members = {}, []
    for r in rows:
        if r["sk"].startswith("MEMBER#"):
            mid = r["sk"].split("#", 1)[1]
            members.append(mid)
            if r.get("busyUpdatedAt"):
                busy[mid] = [(_num(a), _num(b)) for a, b in (r.get("busy") or [])]
    return busy, members


def get_free(group_id: str, query: dict) -> dict:
    try:
        start, end = _num(query.get("from")), _num(query.get("to"))
        min_minutes = max(5, min(_num(query.get("minMinutes", 30)), 600))
    except (TypeError, ValueError):
        raise HttpError(400, "from, to and minMinutes are required numbers")
    if end <= start or end - start > 7 * 24 * 3600_000:
        raise HttpError(400, "Bad window")
    busy, members = _busy_map(_query(group_id))
    slots = free_slots(busy, (start, end), min_minutes)
    return {"slots": [{"start": s, "end": e} for s, e in slots], "reporting": len(busy), "members": len(members)}


def split(group_id: str) -> dict:
    rows = _query(group_id)
    meta = next((r for r in rows if r["sk"] == "META"), None)
    if not meta or meta["mode"] != "team":
        raise HttpError(400, "Split only works in team groups")
    busy, members = _busy_map(rows)
    items = [
        {
            "itemId": r["sk"].split("#", 1)[1],
            "start": _num(r["start"]),
            "end": _num(r["end"]),
            "going": list(r.get("going") or []),
        }
        for r in rows
        if r["sk"].startswith("ITEM#") and r["kind"] == "session"
    ]
    assignments, unassigned = split_sessions(items, sorted(members), busy)
    for item_id in [i["itemId"] for i in items]:
        key = {"pk": _pk(group_id), "sk": f"ITEM#{item_id}"}
        if item_id in assignments:
            table().update_item(
                Key=key, UpdateExpression="SET assignee = :a", ExpressionAttributeValues={":a": assignments[item_id]}
            )
        else:
            table().update_item(Key=key, UpdateExpression="REMOVE assignee")
    return {"assignments": assignments, "unassigned": unassigned}


def leave(group_id: str, me: str) -> dict:
    rows = _query(group_id)
    table().delete_item(Key={"pk": _pk(group_id), "sk": f"MEMBER#{me}"})
    if not (_member_ids(rows) - {me}):
        # Last one out: the group, its calendar and its invite code go too.
        meta = next((r for r in rows if r["sk"] == "META"), None)
        if meta:
            _delete_group(rows, meta)
    else:
        _scrub_member(rows, me)
    return {}


def remove_member(group_id: str, me: str, member_id: str) -> dict:
    """Owner only. For members who are gone for good, like someone who lost their phone."""
    rows, _ = _require_owner(group_id, me)
    if member_id == me:
        raise HttpError(400, "Use Leave group to leave your own group")
    if member_id not in _member_ids(rows):
        raise HttpError(404, "That member is not in this group")
    table().delete_item(Key={"pk": _pk(group_id), "sk": f"MEMBER#{member_id}"})
    _scrub_member(rows, member_id)
    return {}


def delete_group(group_id: str, me: str) -> dict:
    """Owner only. Removes the group for everyone."""
    rows, meta = _require_owner(group_id, me)
    _delete_group(rows, meta)
    return {}
