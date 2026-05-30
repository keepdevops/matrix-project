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


# ---------------------------------------------------------------------------
# Active-mode GET endpoint
# ---------------------------------------------------------------------------

def test_get_active_mode_returns_current(matrix):
    matrix.set_mode('pipeline')
    s, j = matrix.get('/api/modes/active')
    assert s == 200
    assert j['mode'] == 'pipeline'


def test_get_active_mode_updates_after_switch(matrix):
    matrix.set_mode('flat')
    matrix.set_mode('cascade')
    s, j = matrix.get('/api/modes/active')
    assert s == 200
    assert j['mode'] == 'cascade'


# ---------------------------------------------------------------------------
# Per-mode roster GET endpoint
# ---------------------------------------------------------------------------

def test_get_pipeline_agents_reflects_put(matrix):
    matrix.set_roster('pipeline', ['architect', 'programmer'], synthesizer='reviewer')
    s, j = matrix.get('/api/modes/pipeline/agents')
    assert s == 200
    assert j['agents'] == ['architect', 'programmer']
    assert j.get('synthesizer') == 'reviewer'


def test_get_router_agents_reflects_max_select(matrix):
    matrix.set_roster('router', ['foreman', 'programmer'], max_select=1)
    s, j = matrix.get('/api/modes/router/agents')
    assert s == 200
    assert j.get('max_select') == 1


# ---------------------------------------------------------------------------
# Empty roster → full swarm fallback
# ---------------------------------------------------------------------------

def test_pipeline_empty_roster_uses_full_swarm(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', [])
    env = matrix.dispatch('go')
    assert set(env['meta']['order']) == {'architect', 'foreman', 'programmer', 'reviewer'}


def test_cascade_empty_roster_uses_full_swarm(matrix):
    # With no roster set, cascade should broadcast to every deployed agent.
    matrix.set_mode('cascade')
    matrix.set_roster('cascade', [], synthesizer='architect')
    env = matrix.dispatch('build')
    participants = set(env['meta'].get('participants', env['agents'].keys()))
    # All non-synthesizer agents must appear.
    assert {'foreman', 'programmer', 'reviewer'}.issubset(participants)


def test_router_empty_roster_uses_full_swarm(matrix):
    matrix.set_mode('router')
    matrix.set_roster('router', [], max_select=2)
    matrix.mocks['foreman'].reply_template = 'SELECTED: programmer, reviewer'
    env = matrix.dispatch('code review')
    assert sorted(env['agents'].keys()) == ['programmer', 'reviewer']


# ---------------------------------------------------------------------------
# Pipeline: explicit order key
# ---------------------------------------------------------------------------

def test_pipeline_explicit_order_overrides_roster_sequence(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['architect', 'programmer', 'reviewer'],
                      order=['reviewer', 'architect', 'programmer'])
    env = matrix.dispatch('test order')
    assert env['meta']['order'] == ['reviewer', 'architect', 'programmer']


# ---------------------------------------------------------------------------
# Pipeline: meta.stage_outputs
# ---------------------------------------------------------------------------

def test_pipeline_meta_stage_outputs_populated(matrix):
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['architect', 'programmer'])
    env = matrix.dispatch('hello stages')
    stage_outputs = env['meta'].get('stage_outputs', [])
    agents_in_outputs = {entry['agent'] for entry in stage_outputs}
    assert 'architect' in agents_in_outputs
    assert 'programmer' in agents_in_outputs


# ---------------------------------------------------------------------------
# Flat: meta.participants
# ---------------------------------------------------------------------------

def test_flat_meta_participants_lists_all_agents(matrix):
    # NOTE: docs say flat ignores per-mode roster and always broadcasts to all
    # deployed agents; the existing roster-override test contradicts this —
    # actual behavior (per passing tests) is that flat DOES honor rosters.
    # This test verifies meta.participants when no roster is set (full swarm).
    matrix.set_mode('flat')
    env = matrix.dispatch('hello')
    participants = env['meta'].get('participants', [])
    assert set(participants) == {'architect', 'foreman', 'programmer', 'reviewer'}


# ---------------------------------------------------------------------------
# Cascade: meta.excluded on agent failure
# ---------------------------------------------------------------------------

def test_cascade_meta_excluded_populated_on_failure(matrix):
    matrix.mocks['programmer'].fail = True
    matrix.set_mode('cascade')
    matrix.set_roster('cascade', ['programmer', 'reviewer'], synthesizer='architect')
    env = matrix.dispatch('build thing')
    excluded = env['meta'].get('excluded', [])
    assert 'programmer' in excluded


# ---------------------------------------------------------------------------
# Router: classifier_policy config key
# ---------------------------------------------------------------------------

def test_router_classifier_policy_round_trips(matrix):
    matrix.set_roster('router', ['foreman', 'programmer', 'reviewer'],
                      max_select=2, classifier_policy='code')
    s, j = matrix.get('/api/modes/router/agents')
    assert s == 200
    assert j.get('classifier_policy') == 'code'
