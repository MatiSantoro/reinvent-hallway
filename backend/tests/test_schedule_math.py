from schedule_math import free_slots, merge, split_sessions

M = 60_000


def test_merge_overlapping_and_touching():
    assert merge([(10, 20), (15, 30), (30, 40), (50, 60)]) == [(10, 40), (50, 60)]


def test_free_slots_respects_window_and_min_length():
    busy = {"a": [(10 * M, 20 * M)], "b": [(25 * M, 50 * M)]}
    # window 0..60 min: free 0-10, 20-25 (too short), 50-60
    assert free_slots(busy, (0, 60 * M), 10) == [(0, 10 * M), (50 * M, 60 * M)]


def test_free_slots_with_nobody_busy_is_whole_window():
    assert free_slots({}, (0, 60 * M), 30) == [(0, 60 * M)]


def test_split_balances_and_avoids_overlaps():
    items = [
        {"itemId": "i1", "start": 0, "end": 60 * M, "going": []},
        {"itemId": "i2", "start": 0, "end": 60 * M, "going": []},
        {"itemId": "i3", "start": 0, "end": 60 * M, "going": []},
    ]
    assignments, unassigned = split_sessions(items, ["a", "b"], {})
    assert set(assignments.values()) == {"a", "b"}  # same time: one each
    assert len(unassigned) == 1


def test_split_skips_busy_member_unless_going():
    items = [{"itemId": "i1", "start": 0, "end": 60 * M, "going": []}]
    busy = {"a": [(30 * M, 90 * M)]}
    assert split_sessions(items, ["a", "b"], busy)[0] == {"i1": "b"}
    items[0]["going"] = ["a"]
    assert split_sessions(items, ["a", "b"], busy)[0] == {"i1": "a"}


def test_split_ignores_own_reservation_of_same_session():
    items = [{"itemId": "i1", "start": 0, "end": 60 * M, "going": []}]
    busy = {"a": [(0, 60 * M)], "b": [(0, 30 * M)]}
    assert split_sessions(items, ["a", "b"], busy)[0] == {"i1": "a"}
