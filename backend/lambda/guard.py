"""Guards in front of the Lambda: a shared app key, and a daily cap on /plan (the route that costs money).

Neither one identifies a person. The backend never sees the Builder ID token (see DECISIONS.md),
so these only keep casual callers out and put a ceiling on the Bedrock bill.
"""

from __future__ import annotations

import hmac
import os
import time

from botocore.exceptions import ClientError

import groups

QUOTA_TTL_SECONDS = 3 * 86400


def check_api_key(headers: dict[str, str]) -> None:
    """Rejects calls without the key the app ships with. API_KEY unset means no check (local runs and tests)."""
    expected = os.environ.get("API_KEY", "")
    if not expected:
        return
    given = headers.get("x-api-key", "")
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise groups.HttpError(401, "Missing or invalid app key")


def take_plan_slot() -> None:
    """Counts one /plan call for today (UTC). Raises 429 once the daily limit is used up.

    One atomic conditional write, so concurrent calls can never go over the limit.
    """
    limit = int(os.environ.get("PLAN_DAILY_LIMIT", "100"))
    day = time.strftime("%Y-%m-%d", time.gmtime())
    try:
        groups.table().update_item(
            Key={"pk": f"QUOTA#plan#{day}", "sk": "COUNT"},
            UpdateExpression="ADD #n :one SET expiresAt = :exp",
            ConditionExpression="attribute_not_exists(#n) OR #n < :limit",
            ExpressionAttributeNames={"#n": "n"},
            ExpressionAttributeValues={":one": 1, ":limit": limit, ":exp": int(time.time()) + QUOTA_TTL_SECONDS},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise groups.HttpError(429, "Daily planning limit reached. Try again tomorrow (UTC).") from e
        raise
