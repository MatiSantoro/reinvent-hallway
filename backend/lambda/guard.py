"""Guards in front of the Lambda: a shared app key, and daily caps on the routes that cost money or fill the table.

None of these identify a person. The backend never sees the Builder ID token (see DECISIONS.md),
and the app key ships inside the app, so anyone can read it. What really protects the bill is the caps:
  - one cap shared by everyone on /plan (the route that calls Bedrock), and
  - a smaller cap per caller address, so one person cannot use up the shared one for everybody else.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from contextvars import ContextVar

from botocore.exceptions import ClientError

import groups

QUOTA_TTL_SECONDS = 3 * 86400

# Set once per request by the handler. API Gateway fills in the real caller address itself, so a client
# cannot fake it the way it can fake an X-Forwarded-For header.
_caller: ContextVar[str] = ContextVar("caller", default="unknown")


def set_caller(ip: str | None) -> None:
    _caller.set(ip or "unknown")


def check_api_key(headers: dict[str, str]) -> None:
    """Rejects calls without the key the app ships with. API_KEY unset means no check (local runs and tests)."""
    expected = os.environ.get("API_KEY", "")
    if not expected:
        return
    given = headers.get("x-api-key", "")
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise groups.HttpError(401, "Missing or invalid app key")


def _day() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def _who() -> str:
    # Only a short hash of the address is stored, never the address itself.
    return hashlib.sha256(_caller.get().encode()).hexdigest()[:16]


def _take(pk: str, limit: int, message: str) -> None:
    """Counts one use under `pk`. One atomic conditional write, so concurrent calls can never go over `limit`."""
    if limit <= 0:  # a limit of 0 is the off switch: nothing gets through, not even the first call
        raise groups.HttpError(429, message)
    try:
        groups.table().update_item(
            Key={"pk": pk, "sk": "COUNT"},
            UpdateExpression="ADD #n :one SET expiresAt = :exp",
            ConditionExpression="attribute_not_exists(#n) OR #n < :limit",
            ExpressionAttributeNames={"#n": "n"},
            ExpressionAttributeValues={":one": 1, ":limit": limit, ":exp": int(time.time()) + QUOTA_TTL_SECONDS},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise groups.HttpError(429, message) from e
        raise


def take_plan_slot() -> None:
    """Counts one /plan call: first against this caller's own limit, then against the shared daily limit (UTC)."""
    day = _day()
    _take(
        f"QUOTA#plan#{day}#ip#{_who()}",
        int(os.environ.get("PLAN_DAILY_LIMIT_PER_IP", "25")),
        "You have used your planning calls for today. Try again tomorrow (UTC).",
    )
    _take(
        f"QUOTA#plan#{day}",
        int(os.environ.get("PLAN_DAILY_LIMIT", "100")),
        "Daily planning limit reached. Try again tomorrow (UTC).",
    )


def take_group_slot() -> None:
    """Counts one group creation for this caller today, so nobody can fill the table with groups."""
    _take(
        f"QUOTA#group#{_day()}#ip#{_who()}",
        int(os.environ.get("GROUP_DAILY_LIMIT_PER_IP", "20")),
        "You have created the maximum number of groups for today. Try again tomorrow (UTC).",
    )
