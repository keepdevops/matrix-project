"""Integration tests for per-agent timing metrics (#8)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from sse_client import collect_events  # noqa: E402

COORD_PORT = 18000


def test_dispatch_envelope_includes_per_agent_timings(matrix):
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])
    env = matrix.dispatch('hi')
    timings = env['meta'].get('timings')
    assert timings, 'meta.timings must be populated'
    assert sorted(timings.keys()) == ['architect', 'reviewer']
    for name, t in timings.items():
        assert t['calls'] == 1
        assert t['total_ms'] > 0
        # Mock reports completion_tokens as word count of the canned reply.
        assert t['completion_tokens'] > 0
    assert env['meta'].get('wall_ms', 0) > 0


def test_metrics_reset_between_dispatches(matrix):
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect'])
    matrix.dispatch('first')
    env = matrix.dispatch('second')
    # Only architect was called THIS dispatch; if reset works, only it appears.
    assert list(env['meta']['timings'].keys()) == ['architect']
    assert env['meta']['timings']['architect']['calls'] == 1


def test_streaming_emits_metrics_event(matrix):
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])
    events = collect_events('127.0.0.1', COORD_PORT,
                            '/api/architect/stream', {'prompt': 'hi'})
    metrics_events = [e for e in events if e['event'] == 'metrics']
    assert len(metrics_events) == 1
    payload = metrics_events[0]['data']
    assert sorted(payload.keys()) == ['architect', 'reviewer']
    for t in payload.values():
        assert t['calls'] >= 1
        assert t['total_ms'] > 0
