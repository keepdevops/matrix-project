"""
Wait/follow-up helpers for demo_playwright_actions.py.
Extracted from demo_playwright_actions to keep each module under ceiling.
"""

import time

from playwright.sync_api import TimeoutError as PWTimeout

from demo_playwright_actions import shot, RESP_TMO, POLL_MS


def wait_for_response(page, shots_dir, shot_idx, label):
    """
    Wait until .ct-thinking is gone and BROADCAST button is re-enabled.
    Returns the new turn count.
    """
    deadline = time.time() + RESP_TMO / 1000
    while time.time() < deadline:
        page.wait_for_timeout(POLL_MS)
        thinking = page.query_selector(".ct-thinking")
        broadcast_disabled = page.evaluate(
            "() => { const b = document.querySelector('.prompt-input button'); return b ? b.disabled : true; }"
        )
        if not thinking and not broadcast_disabled:
            turns = page.query_selector_all(".ct-turn")
            n = len(turns)
            print(f"  ✓  Response complete — {n} turn(s) in thread")
            shot(page, shots_dir, shot_idx, label)
            return n
    shot(page, shots_dir, shot_idx, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for response ({label})")


def follow_up(page, prompt_text, shots_dir, shot_idx, label):
    """Type a follow-up in the conversation reply box and click SEND."""
    print(f"\n{'─'*60}\nFollow-up: {prompt_text[:60]}…\n{'─'*60}")
    reply = page.query_selector(".ct-reply-input")
    if not reply:
        raise RuntimeError(".ct-reply-input not found — is there an active session?")
    reply.fill(prompt_text)
    page.query_selector(".ct-reply-form button").click()
    print("  … waiting for follow-up response…")
    return wait_for_response(page, shots_dir, shot_idx, label)
