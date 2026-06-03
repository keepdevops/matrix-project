"""Integration tests for /api/architect/stream across all four modes (#3).

Asserts the per-mode SSE event taxonomy:
  flat:     token* + agent_done* + done
  cascade:  token* + agent_done* + [synthesis_start + token* + agent_done] + done
  pipeline: stage + token* + agent_done  (× N stages) + [synthesis_start ...] + done
  router:   selected + token* + agent_done* + done

The mock agent emits one chunk per word, so token counts roughly equal the
word count of the canned reply template (with leading boundary chunks)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from sse_client import collect_events  # noqa: E402

COORD_PORT = 18000  # matches conftest


def _stream(matrix, prompt='hi'):
    return collect_events('127.0.0.1', COORD_PORT,
                          '/api/architect/stream', {'prompt': prompt})


def _by_event(events, name):
    return [e for e in events if e['event'] == name]


def _agents_with_tokens(events):
    seen = set()
    for e in events:
        if e['event'] == 'token' and isinstance(e['data'], dict):
            seen.add(e['data'].get('agent'))
    return seen


def test_stream_flat(matrix):
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])
    events = _stream(matrix)
    assert _by_event(events, 'done'), 'must end with done'
    assert _agents_with_tokens(events) == {'architect', 'reviewer'}
    done_agents = sorted(e['data']['agent'] for e in _by_event(events, 'agent_done'))
    assert done_agents == ['architect', 'reviewer']
    # No mode-specific events fire in flat.
    assert not _by_event(events, 'stage')
    assert not _by_event(events, 'selected')
    assert not _by_event(events, 'synthesis_start')


def test_stream_pipeline_emits_stage_events(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['architect', 'programmer', 'reviewer'])
    events = _stream(matrix, 'design something')
    stage = _by_event(events, 'stage')
    assert len(stage) == 3
    # Stages arrive in order with monotonic step counter.
    assert [e['data']['agent'] for e in stage] == ['architect', 'programmer', 'reviewer']
    assert [e['data']['step'] for e in stage] == [1, 2, 3]
    assert all(e['data']['total'] == 3 for e in stage)
    assert _by_event(events, 'done')


def test_stream_pipeline_synthesis_runs_last(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['programmer', 'reviewer'], synthesizer='architect')
    events = _stream(matrix)
    # synthesis_start fires after both stages are done.
    types_in_order = [e['event'] for e in events
                      if e['event'] in ('agent_done', 'synthesis_start')]
    # Expect: agent_done(programmer), agent_done(reviewer), synthesis_start, agent_done(architect)
    assert types_in_order.index('synthesis_start') == 2
    synth = _by_event(events, 'synthesis_start')
    assert len(synth) == 1 and synth[0]['data']['agent'] == 'architect'
    # The chain itself is just 2 stages — synthesizer is not a chain stage.
    assert len(_by_event(events, 'stage')) == 2


def test_stream_cascade_emits_synthesis(matrix):
    matrix.set_mode('cascade')
    matrix.set_roster('cascade', ['programmer', 'reviewer'], synthesizer='architect')
    events = _stream(matrix)
    synth = _by_event(events, 'synthesis_start')
    assert len(synth) == 1 and synth[0]['data']['agent'] == 'architect'
    # Both parallel agents finished before synthesis kicked off.
    done_seq = [e['data']['agent'] for e in _by_event(events, 'agent_done')]
    assert done_seq[-1] == 'architect'  # synthesizer is last
    assert set(done_seq[:-1]) == {'programmer', 'reviewer'}


def test_stream_router_emits_selected_then_streams_chosen(matrix):
    matrix.set_mode('router')
    matrix.set_roster('router', ['foreman', 'architect', 'programmer', 'reviewer'], max_select=2)
    matrix.mocks['foreman'].reply_template = 'SELECTED: programmer, reviewer'
    events = _stream(matrix, 'refactor please')
    sel = _by_event(events, 'selected')
    assert len(sel) == 1
    assert sel[0]['data']['classifier'] == 'foreman'
    assert sorted(sel[0]['data']['agents']) == ['programmer', 'reviewer']
    # Only the selected agents stream tokens.
    assert _agents_with_tokens(events) == {'programmer', 'reviewer'}


def test_stream_breaker_excludes_unhealthy_from_stream(matrix):
    matrix.mocks['reviewer'].fail = True
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])
    # Trip the breaker via 3 non-streaming dispatches first.
    for _ in range(3):
        matrix.dispatch('warmup')
    s, snap = matrix.get('/api/health/agents')
    assert snap['reviewer']['tripped'] is True
    # Now stream — reviewer must be filtered out.
    events = _stream(matrix)
    assert _agents_with_tokens(events) == {'architect'}


# ---------------------------------------------------------------------------
# MS-161 Phase C — backend routing in the streaming sequential path.
# Routing is opt-in (MATRIX_BACKEND_ROUTING=1) and only activates for
# sequential modes (pipeline / cascade / router); flat stays legacy.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('matrix', [{'MATRIX_BACKEND_ROUTING': '1'}], indirect=True)
def test_stream_pipeline_emits_routing_when_enabled(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['architect', 'programmer', 'reviewer'])
    events = _stream(matrix, 'design something')
    routing = _by_event(events, 'routing')
    assert routing, 'routing event must fire for a sequential stream mode when enabled'
    decisions = routing[0]['data']
    assert decisions, 'routing snapshot must carry per-agent decisions'
    assert set(decisions) <= {'architect', 'programmer', 'reviewer'}
    # Mock agents declare engine "llama" → routed to the llama_metal transport.
    for agent, d in decisions.items():
        assert d['backend'] == 'llama_metal', f"{agent} routed to {d['backend']}"
    assert _by_event(events, 'done')


@pytest.mark.parametrize('matrix', [{'MATRIX_BACKEND_ROUTING': '1'}], indirect=True)
def test_stream_flat_stays_legacy_no_routing(matrix):
    # Flat mode must not route even when routing is enabled (should_route rejects it).
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])
    events = _stream(matrix)
    assert not _by_event(events, 'routing'), 'flat mode must stay legacy — no routing event'
    assert _agents_with_tokens(events) == {'architect', 'reviewer'}
    assert _by_event(events, 'done')
