"""Integration test for mode presets (#7)."""


def test_preset_save_apply_delete(matrix):
    # Initially empty.
    s, j = matrix.get('/api/presets')
    assert s == 200 and j == {}

    # Save a preset.
    s, j = matrix.put('/api/presets/design-review', {
        'mode': 'cascade',
        'agents': ['programmer', 'reviewer'],
        'synthesizer': 'architect',
    })
    assert s == 200 and j['persisted'] is True

    # Save another with max_select.
    matrix.put('/api/presets/router-fast', {
        'mode': 'router',
        'agents': ['foreman', 'programmer', 'reviewer'],
        'max_select': 1,
    })

    # List shows both.
    s, j = matrix.get('/api/presets')
    assert sorted(j.keys()) == ['design-review', 'router-fast']

    # Apply design-review → cascade with that roster + synth.
    s, j = matrix.post('/api/presets/design-review/apply')
    assert s == 200 and j['mode'] == 'cascade'
    assert j['applied']['agents'] == ['programmer', 'reviewer']
    assert j['applied']['synthesizer'] == 'architect'

    # Active mode should now be cascade.
    s, j = matrix.get('/api/modes/active')
    assert j['mode'] == 'cascade'

    # Cascade roster reflects the preset.
    s, j = matrix.get('/api/modes/cascade/agents')
    assert j['agents'] == ['programmer', 'reviewer']
    assert j['synthesizer'] == 'architect'
    assert j['explicit'] is True

    # Delete preset.
    s, j = matrix.delete('/api/presets/design-review')
    assert s == 200 and j['removed'] is True
    s, j = matrix.get('/api/presets')
    assert list(j.keys()) == ['router-fast']


def test_preset_drops_unknown_agents(matrix):
    matrix.put('/api/presets/has-ghost', {
        'mode': 'flat',
        'agents': ['architect', 'ghost-agent'],
    })
    s, j = matrix.post('/api/presets/has-ghost/apply')
    assert s == 200
    assert j['applied']['agents'] == ['architect']  # ghost dropped
    assert 'ghost-agent' in j['unknown']
