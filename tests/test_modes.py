"""Integration tests for each mode + the per-mode roster API."""
import pytest


def test_health_and_agents(matrix):
    s, j = matrix.get('/api/health')
    assert s == 200 and j['status'] == 'ok'
    s, agents = matrix.get('/api/agents')
    assert s == 200
    assert sorted(a['name'] for a in agents) == ['architect', 'foreman', 'programmer', 'reviewer']


def test_modes_registered(matrix):
    s, j = matrix.get('/api/modes')
    assert s == 200
    names = sorted(m['name'] for m in j)
    assert names == ['cascade', 'flat', 'pipeline', 'router']


def test_flat_broadcasts_to_all(matrix):
    matrix.set_mode('flat')
    env = matrix.dispatch('hello')
    assert env['mode'] == 'flat'
    # All 4 agents respond in flat with no roster override.
    assert sorted(env['agents'].keys()) == ['architect', 'foreman', 'programmer', 'reviewer']
    assert env['final'] is None  # flat has no reducer


def test_flat_honors_roster_override(matrix):
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])
    env = matrix.dispatch('hello')
    assert sorted(env['agents'].keys()) == ['architect', 'reviewer']


def test_pipeline_runs_in_order(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['architect', 'programmer', 'reviewer'])
    env = matrix.dispatch('design a queue')
    order = env['meta']['order']
    assert order == ['architect', 'programmer', 'reviewer']
    # Each stage's prompt should reference the previous agent (after stage 1).
    assert 'architect' in matrix.mocks['programmer'].prompts_received[0]
    assert 'programmer' in matrix.mocks['reviewer'].prompts_received[0]


def test_pipeline_synthesis_replaces_final(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['programmer', 'reviewer'], synthesizer='architect')
    env = matrix.dispatch('test prompt')
    # Synthesizer ran and is the final output.
    assert env['meta']['synthesizer'] == 'architect'
    assert env['final'].startswith('[architect] received:')
    # Architect should NOT appear in the chain (synthesizer is excluded).
    assert env['meta']['order'] == ['programmer', 'reviewer']


def test_cascade_parallel_then_synthesis(matrix):
    matrix.set_mode('cascade')
    matrix.set_roster('cascade', ['programmer', 'reviewer'], synthesizer='architect')
    env = matrix.dispatch('build a thing')
    assert env['mode'] == 'cascade'
    assert sorted(env['meta']['participants']) == ['programmer', 'reviewer']
    assert env['meta']['synthesizer'] == 'architect'
    # Synthesizer prompt must contain both contributors' outputs.
    synth_prompt = matrix.mocks['architect'].prompts_received[0]
    assert 'programmer' in synth_prompt and 'reviewer' in synth_prompt


def test_cascade_without_synthesizer_degrades_to_flat(matrix):
    matrix.set_mode('cascade')
    matrix.set_roster('cascade', ['programmer', 'reviewer'])
    env = matrix.dispatch('plain')
    assert env['final'] is None
    assert sorted(env['agents'].keys()) == ['programmer', 'reviewer']


def test_router_classifies_and_dispatches(matrix):
    matrix.set_mode('router')
    matrix.set_roster('router', ['foreman', 'architect', 'programmer', 'reviewer'], max_select=2)
    # Make foreman emit a SELECTED line our parser will accept.
    matrix.mocks['foreman'].reply_template = 'SELECTED: programmer, reviewer'
    env = matrix.dispatch('refactor code')
    assert env['meta']['classifier'] == 'foreman'
    selected = env['meta']['selected']
    assert sorted(selected) == ['programmer', 'reviewer']
    # Router emits only the selected agents in `agents`, not the classifier.
    assert sorted(env['agents'].keys()) == ['programmer', 'reviewer']


def test_router_drops_unknown_agents_in_selected(matrix):
    matrix.set_mode('router')
    matrix.set_roster('router', ['foreman', 'programmer', 'reviewer'], max_select=2)
    # Foreman emits one valid + one bogus name; bogus must be filtered out.
    matrix.mocks['foreman'].reply_template = 'SELECTED: programmer, ghost-agent'
    env = matrix.dispatch('refactor')
    assert env['meta']['selected'] == ['programmer']
    assert sorted(env['agents'].keys()) == ['programmer']
