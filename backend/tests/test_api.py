import json

import boto3
import pytest
from moto import mock_aws

M = 60_000


@pytest.fixture()
def api(monkeypatch):
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName="hallway",
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}, {"AttributeName": "sk", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        import groups
        import handler

        monkeypatch.setattr(groups, "_table", None)
        monkeypatch.setenv("API_KEY", "test-key")

        def call(method, path, body=None, member=None, query=None, key="test-key", ip="203.0.113.7"):
            headers = {"X-Api-Key": key} if key is not None else {}
            if member:
                headers.update({"X-Member-Id": member["memberId"], "X-Member-Secret": member["secret"]})
            ev = {
                "requestContext": {"http": {"method": method, "sourceIp": ip}},
                "rawPath": path,
                "headers": headers,
                "queryStringParameters": query,
                "body": json.dumps(body) if body is not None else None,
            }
            r = handler.lambda_handler(ev, None)
            return r["statusCode"], json.loads(r["body"])

        yield call


def test_full_group_flow(api):
    s, a = api("POST", "/groups", {"name": "Builders", "mode": "team", "displayName": "Matias", "eventId": "reinvent2026"})
    assert s == 200
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]

    s, b = api("POST", "/groups/join", {"inviteCode": code.lower(), "displayName": "Ana"})
    assert s == 200 and b["group"]["groupId"] == gid

    # Wrong secret is refused
    s, _ = api("GET", f"/groups/{gid}", member={"memberId": a["memberId"], "secret": "nope"})
    assert s == 403

    s, item = api("POST", f"/groups/{gid}/items", {"kind": "session", "sessionId": "S1", "title": "Agents", "start": 0, "end": 60 * M}, member=a)
    assert s == 200 and item["going"] == [a["memberId"]]
    s, _ = api("POST", f"/groups/{gid}/items", {"kind": "session", "sessionId": "S1", "title": "dup", "start": 0, "end": 60 * M}, member=b)
    assert s == 409

    s, it = api("PUT", f"/groups/{gid}/items/{item['itemId']}/rsvp", {"going": True}, member=b)
    assert set(it["going"]) == {a["memberId"], b["memberId"]}

    # Busy + free time
    api("PUT", f"/groups/{gid}/busy", {"slots": [{"start": 0, "end": 60 * M}]}, member=a)
    api("PUT", f"/groups/{gid}/busy", {"slots": [{"start": 90 * M, "end": 120 * M}]}, member=b)
    s, free = api("GET", f"/groups/{gid}/free", member=a, query={"from": "0", "to": str(180 * M), "minMinutes": "30"})
    assert s == 200 and free["reporting"] == 2
    assert free["slots"] == [{"start": 60 * M, "end": 90 * M}, {"start": 120 * M, "end": 180 * M}]

    # Busy slots are never exposed
    s, st = api("GET", f"/groups/{gid}", member=b)
    assert all("busy" not in m for m in st["members"])  # times stay private
    assert st["me"] == b["memberId"]

    # Team split
    api("POST", f"/groups/{gid}/items", {"kind": "session", "sessionId": "S2", "title": "Serverless", "start": 0, "end": 60 * M}, member=b)
    s, sp = api("POST", f"/groups/{gid}/split", {}, member=a)
    assert s == 200 and len(sp["assignments"]) == 2
    assert len(set(sp["assignments"].values())) == 2

    # Only the creator can remove
    s, _ = api("DELETE", f"/groups/{gid}/items/{item['itemId']}", member=b)
    assert s == 403
    s, _ = api("DELETE", f"/groups/{gid}/items/{item['itemId']}", member=a)
    assert s == 200

    s, _ = api("DELETE", f"/groups/{gid}/members/me", member=b)
    assert s == 200
    s, _ = api("GET", f"/groups/{gid}", member=b)
    assert s == 403


def test_validation(api):
    s, _ = api("POST", "/groups", {"name": "", "displayName": "x"})
    assert s == 400
    s, _ = api("POST", "/groups/join", {"inviteCode": "NOPE1234", "displayName": "x"})
    assert s == 404
    s, _ = api("GET", "/nope")
    assert s == 404


def test_app_key_is_required(api):
    assert api("POST", "/groups", {"name": "x", "displayName": "y"}, key=None)[0] == 401
    assert api("POST", "/groups", {"name": "x", "displayName": "y"}, key="wrong")[0] == 401
    assert api("POST", "/groups", {"name": "x", "displayName": "y"})[0] == 200


PLAN_BODY = {"goals": "agents", "candidates": [{"id": "s1", "title": "Agents 101"}], "maxPicks": 1}


@pytest.fixture()
def fake_bedrock(monkeypatch):
    import planner

    class Fake:
        calls = 0

        def converse(self, **kw):
            Fake.calls += 1
            return {"output": {"message": {"content": [{"toolUse": {"name": "submit_plan", "input": {
                "summary": "ok", "picks": [{"sessionId": "s1", "reason": "fits"}]}}}]}}}

    monkeypatch.setattr(planner, "_client", lambda: Fake())
    return Fake


def test_plan_daily_limit(api, fake_bedrock, monkeypatch):
    monkeypatch.setenv("PLAN_DAILY_LIMIT", "2")
    assert api("POST", "/plan", PLAN_BODY)[0] == 200
    assert api("POST", "/plan", PLAN_BODY)[0] == 200
    status, body = api("POST", "/plan", PLAN_BODY)
    assert status == 429 and "limit" in body["message"].lower()
    assert fake_bedrock.calls == 2  # the refused call never reached Bedrock


def test_bad_plan_request_does_not_use_a_slot(api, fake_bedrock, monkeypatch):
    monkeypatch.setenv("PLAN_DAILY_LIMIT", "1")
    assert api("POST", "/plan", {"goals": "x", "candidates": []})[0] == 400
    assert api("POST", "/plan", PLAN_BODY)[0] == 200


def test_plan_limit_per_caller_does_not_block_others(api, fake_bedrock, monkeypatch):
    monkeypatch.setenv("PLAN_DAILY_LIMIT", "100")
    monkeypatch.setenv("PLAN_DAILY_LIMIT_PER_IP", "2")
    assert api("POST", "/plan", PLAN_BODY, ip="198.51.100.1")[0] == 200
    assert api("POST", "/plan", PLAN_BODY, ip="198.51.100.1")[0] == 200
    status, body = api("POST", "/plan", PLAN_BODY, ip="198.51.100.1")
    assert status == 429 and "your planning calls" in body["message"].lower()
    # A different caller still gets through, and the refused call never reached Bedrock.
    assert api("POST", "/plan", PLAN_BODY, ip="198.51.100.2")[0] == 200
    assert fake_bedrock.calls == 3


def test_shared_limit_still_applies_across_callers(api, fake_bedrock, monkeypatch):
    monkeypatch.setenv("PLAN_DAILY_LIMIT", "2")
    monkeypatch.setenv("PLAN_DAILY_LIMIT_PER_IP", "10")
    assert api("POST", "/plan", PLAN_BODY, ip="198.51.100.1")[0] == 200
    assert api("POST", "/plan", PLAN_BODY, ip="198.51.100.2")[0] == 200
    assert api("POST", "/plan", PLAN_BODY, ip="198.51.100.3")[0] == 429


def test_group_creation_limit_per_caller(api, monkeypatch):
    monkeypatch.setenv("GROUP_DAILY_LIMIT_PER_IP", "2")
    new = {"name": "g", "displayName": "me"}
    assert api("POST", "/groups", new, ip="198.51.100.1")[0] == 200
    assert api("POST", "/groups", new, ip="198.51.100.1")[0] == 200
    assert api("POST", "/groups", new, ip="198.51.100.1")[0] == 429
    assert api("POST", "/groups", new, ip="198.51.100.2")[0] == 200


def test_caller_address_is_stored_only_as_a_hash(api, fake_bedrock):
    import groups

    assert api("POST", "/plan", PLAN_BODY, ip="198.51.100.9")[0] == 200
    keys = [i["pk"] for i in groups.table().scan()["Items"] if i["pk"].startswith("QUOTA#")]
    assert keys and not any("198.51.100.9" in k for k in keys)


def test_limit_of_zero_turns_planning_off(api, fake_bedrock, monkeypatch):
    monkeypatch.setenv("PLAN_DAILY_LIMIT", "0")
    assert api("POST", "/plan", PLAN_BODY)[0] == 429
    assert fake_bedrock.calls == 0


# ---------- group owner, leaving, and names ----------


def _new_group(api, name="Crew", mode="squad", owner="Ana"):
    s, a = api("POST", "/groups", {"name": name, "mode": mode, "displayName": owner})
    assert s == 200
    return a


def _join(api, code, name):
    s, b = api("POST", "/groups/join", {"inviteCode": code, "displayName": name})
    return s, b


def _who(m):
    return {"memberId": m["memberId"], "secret": m["secret"]}


def _view(api, gid, m):
    s, st = api("GET", f"/groups/{gid}", member=_who(m))
    assert s == 200, st
    return st


def test_creator_is_the_owner(api):
    a = _new_group(api)
    gid = a["group"]["groupId"]
    assert _view(api, gid, a)["ownerId"] == a["memberId"]


def test_last_member_leaving_deletes_the_group(api):
    import groups

    a = _new_group(api)
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    api("POST", f"/groups/{gid}/items", {"kind": "meetup", "title": "Dinner", "start": 10 * M, "end": 20 * M}, member=_who(a))
    assert api("DELETE", f"/groups/{gid}/members/me", member=_who(a))[0] == 200
    assert _join(api, code, "Late")[0] == 404  # the invite code is gone too
    left = [i["pk"] for i in groups.table().scan()["Items"] if i["pk"] == f"GROUP#{gid}" or i["pk"] == f"INVITE#{code}"]
    assert left == []


def test_leaving_keeps_the_group_while_others_remain_and_clears_your_marks(api):
    a = _new_group(api)
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    s, b = _join(api, code, "Ben")
    assert s == 200
    s, item = api("POST", f"/groups/{gid}/items", {"kind": "meetup", "title": "Dinner", "start": 10 * M, "end": 20 * M}, member=_who(a))
    api("PUT", f"/groups/{gid}/items/{item['itemId']}/rsvp", {"going": True}, member=_who(b))
    assert set(_view(api, gid, a)["items"][0]["going"]) == {a["memberId"], b["memberId"]}

    assert api("DELETE", f"/groups/{gid}/members/me", member=_who(b))[0] == 200
    st = _view(api, gid, a)
    assert [m["displayName"] for m in st["members"]] == ["Ana"]
    assert st["items"][0]["going"] == [a["memberId"]]  # no ghost attendance


def test_leaving_clears_a_team_assignment(api):
    import groups

    a = _new_group(api, mode="team")
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    s, b = _join(api, code, "Ben")
    s, item = api("POST", f"/groups/{gid}/items", {"kind": "meetup", "title": "Dinner", "start": 10 * M, "end": 20 * M}, member=_who(a))
    key = {"pk": f"GROUP#{gid}", "sk": f"ITEM#{item['itemId']}"}
    groups.table().update_item(Key=key, UpdateExpression="SET assignee = :a", ExpressionAttributeValues={":a": b["memberId"]})
    api("DELETE", f"/groups/{gid}/members/me", member=_who(b))
    assert "assignee" not in _view(api, gid, a)["items"][0]


def test_ownership_passes_to_the_longest_standing_member(api):
    import time

    a = _new_group(api)
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    time.sleep(0.01)
    s, b = _join(api, code, "Ben")
    time.sleep(0.01)
    s, c = _join(api, code, "Cleo")
    assert api("DELETE", f"/groups/{gid}/members/me", member=_who(a))[0] == 200
    assert _view(api, gid, c)["ownerId"] == b["memberId"]  # Ben joined before Cleo


def test_a_group_from_before_owners_existed_still_has_one(api):
    import time

    import groups

    a = _new_group(api)
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    time.sleep(0.01)
    s, b = _join(api, code, "Ben")
    groups.table().update_item(Key={"pk": f"GROUP#{gid}", "sk": "META"}, UpdateExpression="REMOVE ownerId")
    assert _view(api, gid, b)["ownerId"] == a["memberId"]  # earliest member


def test_only_the_owner_can_remove_a_member(api):
    a = _new_group(api)
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    s, b = _join(api, code, "Ben")
    s, c = _join(api, code, "Cleo")
    assert api("DELETE", f"/groups/{gid}/members/{c['memberId']}", member=_who(b))[0] == 403
    assert api("DELETE", f"/groups/{gid}/members/{a['memberId']}", member=_who(a))[0] == 400  # not yourself
    assert api("DELETE", f"/groups/{gid}/members/{c['memberId']}", member=_who(a))[0] == 200
    assert api("GET", f"/groups/{gid}", member=_who(c))[0] == 403  # Cleo's phone is locked out now
    assert api("DELETE", f"/groups/{gid}/members/nobody123", member=_who(a))[0] == 404


def test_only_the_owner_can_delete_the_group(api):
    a = _new_group(api)
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    s, b = _join(api, code, "Ben")
    assert api("DELETE", f"/groups/{gid}", member=_who(b))[0] == 403
    assert api("DELETE", f"/groups/{gid}", member=_who(a))[0] == 200
    assert _join(api, code, "Cleo")[0] == 404
    assert api("GET", f"/groups/{gid}", member=_who(b))[0] == 403


def test_the_owner_can_remove_anyones_item_but_others_cannot(api):
    a = _new_group(api)
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    s, b = _join(api, code, "Ben")
    s, c = _join(api, code, "Cleo")
    s, item = api("POST", f"/groups/{gid}/items", {"kind": "meetup", "title": "Dinner", "start": 10 * M, "end": 20 * M}, member=_who(b))
    assert api("DELETE", f"/groups/{gid}/items/{item['itemId']}", member=_who(c))[0] == 403
    assert api("DELETE", f"/groups/{gid}/items/{item['itemId']}", member=_who(a))[0] == 200  # a is the owner
    assert _view(api, gid, a)["items"] == []


def test_names_must_be_unique_inside_a_group(api):
    a = _new_group(api, owner="Ana")
    gid, code = a["group"]["groupId"], a["group"]["inviteCode"]
    s, body = _join(api, code, "  ANA ")
    assert s == 409 and "already uses that name" in body["message"]
    s, b = _join(api, code, "Ben")
    assert s == 200
    api("DELETE", f"/groups/{gid}/members/me", member=_who(b))
    assert _join(api, code, "Ben")[0] == 200  # a name frees up when its member leaves
