"""
Broadcast and response-polling helpers for demo scripts.
Split from demo_utils.py; agent-readiness + video helpers live in demo_utils_video.py.
"""

import time

from demo_utils import shot, switch_right_tab

RESP_TMO = 600_000   # 10 min per broadcast
POLL_MS  = 1_500


def broadcast(page, prompt_text, prompt_num=None):
    """Fill the prompt textarea and submit."""
    from demo_utils import log
    label = f"#{prompt_num}" if prompt_num else ""
    log(f"Broadcast {label}: {prompt_text[:65]}…")
    switch_right_tab(page, "Session")
    page.wait_for_timeout(300)
    ta = page.query_selector(".prompt-textarea")
    if not ta:
        raise RuntimeError(".prompt-textarea not found")
    ta.click()
    ta.fill(prompt_text)
    page.query_selector(".prompt-input button[type=submit]").click()
    print("  … broadcasting…")


def wait_for_response(page, shots_dir, label):
    """
    Poll until the broadcast completes. Returns the current turn count.
    Completion: new completed .ct-turn OR thinking gone + submit re-enabled.
    """
    baseline = page.evaluate(
        "() => document.querySelectorAll('.ct-turn:not(.ct-turn--pending)').length"
    )
    deadline = time.time() + RESP_TMO / 1000
    while time.time() < deadline:
        page.wait_for_timeout(POLL_MS)

        completed = page.evaluate(
            """() => {
                const turns = document.querySelectorAll('.ct-turn:not(.ct-turn--pending)');
                return Array.from(turns).filter(t => {
                    const txt = t.querySelector('.ct-bubble--swarm .ct-bubble-text');
                    return txt && txt.textContent.trim().length > 20;
                }).length;
            }"""
        )
        if completed > baseline:
            turns = page.evaluate("() => document.querySelectorAll('.ct-turn').length")
            print(f"  ✓  Response complete — {turns} turn(s)")
            shot(page, shots_dir, label)
            return turns

        thinking = page.query_selector(".ct-thinking")
        btn_disabled = page.evaluate(
            "() => { const b = document.querySelector('.prompt-input button[type=submit]');"
            " return b ? b.disabled : true; }"
        )
        if not thinking and not btn_disabled:
            turns = page.evaluate("() => document.querySelectorAll('.ct-turn').length")
            print(f"  ✓  Response complete (btn enabled) — {turns} turn(s)")
            shot(page, shots_dir, label)
            return turns

    shot(page, shots_dir, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for response ({label})")


def follow_up(page, prompt_text, shots_dir, label):
    """Type a follow-up in the conversation reply box and submit."""
    from demo_utils import log
    log(f"Follow-up: {prompt_text[:65]}…")
    reply = page.query_selector(".ct-reply-input")
    if not reply:
        raise RuntimeError(".ct-reply-input not found — is there an active session?")
    reply.fill(prompt_text)
    page.query_selector(".ct-reply-form button[type=submit]").click()
    print("  … waiting for follow-up…")
    return wait_for_response(page, shots_dir, label)


from demo_utils_video import wait_for_agents_ready, stitch_video  # noqa: F401
