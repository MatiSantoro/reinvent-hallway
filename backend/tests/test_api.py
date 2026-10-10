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

        def call(method, path, body=None, member=None, query=None):
            headers = {}
            if member:
                headers = {"X-Member-Id": member["memberId"], "X-Member-Secret": member["secret"]}
            ev = {
                "requestContext": {"http": {"method": method}},
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
