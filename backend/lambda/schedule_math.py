"""Pure scheduling helpers: common free time and team splits. No AWS calls, easy to test.

All times are epoch milliseconds (UTC).
"""

from __future__ import annotations

from typing import Iterable

Interval = tuple[int, int]


def merge(intervals: Iterable[Interval]) -> list[Interval]:
    """Sorts and merges overlapping or touching intervals."""
    out: list[list[int]] = []
    for start, end in sorted(i for i in intervals if i[1] > i[0]):
        if out and start <= out[-1][1]:
            out[-1][1] = max(out[-1][1], end)
        else:
            out.append([start, end])
    return [(s, e) for s, e in out]


def free_slots(busy_by_member: dict[str, list[Interval]], window: Interval, min_minutes: int) -> list[Interval]:
    """Time inside `window` when nobody in `busy_by_member` is busy, in gaps of at least `min_minutes`."""
    w_start, w_end = window
    busy = merge(
        (max(s, w_start), min(e, w_end))
        for slots in busy_by_member.values()
        for s, e in slots
        if e > w_start and s < w_end
    )
    gaps: list[Interval] = []
    cursor = w_start
    for s, e in busy:
        if s > cursor:
            gaps.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < w_end:
        gaps.append((cursor, w_end))
    min_ms = min_minutes * 60_000
    return [g for g in gaps if g[1] - g[0] >= min_ms]


def _overlaps(a: Interval, b: Interval) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def split_sessions(
    items: list[dict],
    members: list[str],
    busy_by_member: dict[str, list[Interval]],
) -> tuple[dict[str, str], list[str]]:
    """Team mode: give each proposed session to one member so the team covers as much as possible.

    items: [{"itemId", "start", "end", "going": [memberIds]}]
    Rules, in order:
      1. a member can't get two overlapping sessions
      2. a member who is busy at that time (outside this very session) is skipped,
         unless they already said they're going to it
      3. prefer someone who said "I'm in", then whoever has the fewest sessions so far
    Returns (assignments itemId -> memberId, unassigned itemIds).
    """
    load: dict[str, int] = {m: 0 for m in members}
    taken: dict[str, list[Interval]] = {m: [] for m in members}
    assignments: dict[str, str] = {}
    unassigned: list[str] = []

    for item in sorted(items, key=lambda i: (i["start"], i["itemId"])):
        slot = (int(item["start"]), int(item["end"]))
        going = set(item.get("going", []))
        eligible = []
        for m in members:
            if any(_overlaps(slot, t) for t in taken[m]):
                continue
            # Their own reservation of this exact session shows up as busy, so ignore exact matches.
            busy = [b for b in busy_by_member.get(m, []) if tuple(b) != slot]
            if m not in going and any(_overlaps(slot, (b[0], b[1])) for b in busy):
                continue
            eligible.append(m)
        if not eligible:
            unassigned.append(item["itemId"])
            continue
        best = min(eligible, key=lambda m: (m not in going, load[m], m))
        assignments[item["itemId"]] = best
        load[best] += 1
        taken[best].append(slot)
    return assignments, unassigned
