"""Tests for retry-with-backoff and skip-with-warning (#5)."""


def test_retry_recovers_from_transient_failure(matrix):
    # Reviewer fails once then succeeds. With retry enabled, the second
    # attempt succeeds and call_agent should return a healthy response.
    matrix.mocks['reviewer'].fail_first_n = 1
    matrix.set_mode('flat')
    matrix.set_roster('flat', ['reviewer'])
    env = matrix.dispatch('hi')
    text = env['agents']['reviewer']
    # Healthy response includes the reply template prefix; an error response
    # would start with "[reviewer error]" or "Agent reviewer ... not responding".
    assert text.startswith('[reviewer] received:'), f"unexpected: {text!r}"
    # Mock saw two requests: the failed one and the retry.
    assert len(matrix.mocks['reviewer'].prompts_received) == 2


def test_pipeline_records_failure_and_skips_downstream(matrix):
    # Middle stage fails permanently. Pipeline should:
    #   1. Record the failure in meta.errors[].
    #   2. Pass the previous good output to the next stage (not the error).
    matrix.mocks['programmer'].fail = True
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['architect', 'programmer', 'reviewer'])
    env = matrix.dispatch('design something')

    errors = env['meta'].get('errors', [])
    assert len(errors) == 1
    assert errors[0]['agent'] == 'programmer'
    assert errors[0]['step'] == 2

    # Reviewer (step 3) must have received architect's output, NOT programmer's
    # error message — that's the skip-with-warning behavior.
    rev_prompt = matrix.mocks['reviewer'].prompts_received[0]
    assert 'architect' in rev_prompt
    assert 'programmer error' not in rev_prompt
    assert 'is not responding' not in rev_prompt


def test_cascade_excludes_failed_from_synthesis(matrix):
    # In cascade, a failed parallel agent should be:
    #   1. Recorded in meta.errors[]
    #   2. Excluded from the synthesizer's input prompt (no garbage in synthesis).
    matrix.mocks['programmer'].fail = True
    matrix.set_mode('cascade')
    matrix.set_roster('cascade', ['programmer', 'reviewer'], synthesizer='architect')
    env = matrix.dispatch('build a thing')

    errors = env['meta'].get('errors', [])
    assert len(errors) == 1 and errors[0]['agent'] == 'programmer'

    # Architect (synthesizer) prompt must mention reviewer but NOT programmer
    # (the failed agent's error text was filtered out before synthesis).
    synth_prompt = matrix.mocks['architect'].prompts_received[0]
    assert 'reviewer' in synth_prompt
    assert 'programmer error' not in synth_prompt
    assert 'is not responding' not in synth_prompt


def test_pipeline_all_failed_yields_only_errors(matrix):
    # Belt-and-suspenders: if every stage fails, meta.errors[] enumerates them
    # and final is the last attempt's error string (rather than crashing).
    for n in ('architect', 'programmer'):
        matrix.mocks[n].fail = True
    matrix.set_mode('pipeline')
    matrix.set_roster('pipeline', ['architect', 'programmer'])
    env = matrix.dispatch('go')
    errors = env['meta'].get('errors', [])
    assert len(errors) == 2
    assert sorted(e['agent'] for e in errors) == ['architect', 'programmer']
