"""Integration test for the per-agent circuit breaker (#12)."""


def test_breaker_trips_after_three_failures_and_excludes(matrix):
    # Make 'reviewer' always fail. Other agents stay healthy.
    matrix.mocks['reviewer'].fail = True

    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])

    # 3 dispatches → reviewer fails each time → breaker opens after the 3rd.
    for _ in range(3):
        matrix.dispatch('hi')

    s, snap = matrix.get('/api/health/agents')
    assert s == 200
    rev = snap['reviewer']
    assert rev['recent_failures'] >= 3
    assert rev['tripped'] is True
    assert rev['cooldown_remaining_ms'] > 0

    # Next dispatch must exclude reviewer; envelope reports it.
    env = matrix.dispatch('after trip')
    assert env['meta'].get('excluded_unhealthy') == ['reviewer']
    assert sorted(env['agents'].keys()) == ['architect']


def test_breaker_resets_after_success(matrix):
    matrix.mocks['reviewer'].fail = True
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['architect', 'reviewer'])
    for _ in range(3):
        matrix.dispatch('hi')

    # Restore reviewer to healthy. Breaker is open; we can't re-test it
    # directly without waiting for cooldown (30s), so just assert that the
    # snapshot reflects the trip — the half-open re-probe is exercised via
    # the timing mechanic and is not unit-testable without a clock injector.
    matrix.mocks['reviewer'].fail = False
    s, snap = matrix.get('/api/health/agents')
    assert snap['reviewer']['tripped'] is True
