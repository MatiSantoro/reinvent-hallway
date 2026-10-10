import pytest

import planner


def resp(picks, summary="ok"):
    return {"output": {"message": {"content": [{"toolUse": {"name": "submit_plan", "input": {"summary": summary, "picks": picks}}}]}}}


def test_parse_drops_unknown_and_duplicate_ids():
    out = planner.parse_tool_output(
        resp([{"sessionId": "a", "reason": "x"}, {"sessionId": "zzz", "reason": "made up"}, {"sessionId": "a", "reason": "dup"}, {"sessionId": "b", "reason": "y"}]),
        {"a", "b"},
        10,
    )
    assert [p["sessionId"] for p in out["picks"]] == ["a", "b"]


def test_parse_caps_picks():
    out = planner.parse_tool_output(resp([{"sessionId": s, "reason": ""} for s in "abc"]), set("abc"), 2)
    assert len(out["picks"]) == 2


def test_clean_rejects_empty_candidates():
    with pytest.raises(planner.BadRequest):
        planner._clean({"goals": "x", "candidates": []})


def test_plan_calls_bedrock_with_forced_tool(monkeypatch):
    calls = {}

    class Fake:
        def converse(self, **kw):
            calls.update(kw)
            return resp([{"sessionId": "s1", "reason": "fits agents"}])

    monkeypatch.setattr(planner, "_client", lambda: Fake())
    out = planner.plan({"goals": "agents", "candidates": [{"id": "s1", "title": "Agents 101"}], "maxPicks": 5})
    assert out["picks"] == [{"sessionId": "s1", "reason": "fits agents"}]
    assert calls["toolConfig"]["toolChoice"] == {"tool": {"name": "submit_plan"}}
