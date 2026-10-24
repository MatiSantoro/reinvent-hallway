"""Single Lambda behind an API Gateway HTTP API (payload v2). Small router, JSON in and out."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

import groups
import guard
import planner

log = logging.getLogger()
log.setLevel(logging.INFO)

G = r"(?P<g>[A-Za-z0-9xy]{6,20})"
I = r"(?P<i>[A-Za-z0-9xy]{6,20})"

# (method, path regex, needs member auth, handler(match, me, body, query))
ROUTES: list[tuple[str, re.Pattern, bool, Callable[..., Any]]] = [
    ("POST", re.compile(r"^/plan$"), False, lambda m, me, b, q: planner.plan(b, before_call=guard.take_plan_slot)),
    ("POST", re.compile(r"^/groups$"), False, lambda m, me, b, q: _create_group(b)),
    ("POST", re.compile(r"^/groups/join$"), False, lambda m, me, b, q: groups.join_group(b)),
    ("GET", re.compile(rf"^/groups/{G}$"), True, lambda m, me, b, q: groups.get_group(m["g"], me)),
    ("POST", re.compile(rf"^/groups/{G}/items$"), True, lambda m, me, b, q: groups.add_item(m["g"], me, b)),
    ("DELETE", re.compile(rf"^/groups/{G}/items/{I}$"), True, lambda m, me, b, q: groups.remove_item(m["g"], me, m["i"])),
    ("PUT", re.compile(rf"^/groups/{G}/items/{I}/rsvp$"), True, lambda m, me, b, q: groups.set_rsvp(m["g"], me, m["i"], b)),
    ("PUT", re.compile(rf"^/groups/{G}/busy$"), True, lambda m, me, b, q: groups.set_busy(m["g"], me, b)),
    ("GET", re.compile(rf"^/groups/{G}/free$"), True, lambda m, me, b, q: groups.get_free(m["g"], q)),
    ("POST", re.compile(rf"^/groups/{G}/split$"), True, lambda m, me, b, q: groups.split(m["g"])),
    ("DELETE", re.compile(rf"^/groups/{G}/members/me$"), True, lambda m, me, b, q: groups.leave(m["g"], me)),
    ("DELETE", re.compile(rf"^/groups/{G}/members/{I}$"), True, lambda m, me, b, q: groups.remove_member(m["g"], me, m["i"])),
    ("DELETE", re.compile(rf"^/groups/{G}$"), True, lambda m, me, b, q: groups.delete_group(m["g"], me)),
]


def _create_group(body: dict) -> dict:
    guard.take_group_slot()
    return groups.create_group(body)


def _resp(status: int, body: Any) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=lambda o: int(o) if hasattr(o, "to_integral_value") else str(o)),
    }


def lambda_handler(event: dict, context: Any) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "/")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    query = event.get("queryStringParameters") or {}

    try:
        guard.set_caller(event.get("requestContext", {}).get("http", {}).get("sourceIp"))
        guard.check_api_key(headers)
        body = json.loads(event.get("body") or "{}") if method in ("POST", "PUT") else {}
        if not isinstance(body, dict):
            raise groups.HttpError(400, "Body must be a JSON object")
    except json.JSONDecodeError:
        return _resp(400, {"message": "Invalid JSON"})
    except groups.HttpError as e:
        return _resp(e.status, {"message": e.message})

    for m, pattern, needs_auth, fn in ROUTES:
        match = pattern.match(path)
        if not match or m != method:
            continue
        try:
            me = groups.authenticate(match["g"], headers) if needs_auth else None
            return _resp(200, fn(match, me, body, query))
        except groups.HttpError as e:
            return _resp(e.status, {"message": e.message})
        except planner.BadRequest as e:
            return _resp(400, {"message": str(e)})
        except Exception:  # noqa: BLE001
            log.exception("Unhandled error on %s %s", method, path)
            return _resp(500, {"message": "Internal error"})
    return _resp(404, {"message": "Not found"})
