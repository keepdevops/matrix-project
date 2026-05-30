"""Brewlate UI button smoke tests (Playwright).

Requires:
  - Dev server: npm start  →  http://localhost:3000
  - Playwright: pip install playwright && playwright install chromium

Override URL:
  MATRIX_UI_URL=http://127.0.0.1:3000/?layout=brewlate
"""

from __future__ import annotations

import os
import socket
from pathlib import Path

import pytest

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

REPO = Path(__file__).resolve().parents[2]
BREWLATE_URL = os.environ.get(
    "MATRIX_UI_URL",
    "http://localhost:3000/?layout=brewlate&theme=dark",
)

# ── Static markers (no browser) ─────────────────────────────────────────────


def test_brewlate_button_classes_defined_in_layout():
    src = (REPO / "src/layouts/BrewlateLayout.js").read_text()
    css = (REPO / "src/layouts/brewlate.css").read_text()
    for marker in (
        "brew-launch-btn",
        "brew-header-btn",
        "brew-engine-pill",
        "brew-right-tab",
        "brew-monitor-trigger",
        "brew-monitor-clear-btn",
    ):
        assert marker in src or marker in css


def test_brewlate_prompt_uses_brew_labels():
    src = (REPO / "src/layouts/BrewlateLayout.js").read_text()
    assert 'submitLabel="BREW"' in src
    assert 'qualityPassLabel="REFINE"' in src


# ── Playwright (live UI) ────────────────────────────────────────────────────


def _port_open(host: str, port: int, timeout: float = 0.4) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        try:
            s.connect((host, port))
            return True
        except OSError:
            return False


@pytest.fixture(scope="module")
def brewlate_page():
    if not HAS_PLAYWRIGHT:
        pytest.skip("playwright not installed — pip install playwright && playwright install chromium")
    if not _port_open("127.0.0.1", 3000):
        pytest.skip("UI dev server not running on :3000 — start with `npm start`")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(BREWLATE_URL, wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_selector(".layout-brewlate", timeout=20_000)
        # Allow coordinator polling to settle (online ↔ offline).
        page.wait_for_timeout(2_500)
        yield page
        browser.close()


def test_brewlate_shell_and_branding(brewlate_page):
    page = brewlate_page
    assert page.locator(".brew-logo").inner_text() == "Brewlate"
    assert page.locator(".brew-panel-title", has_text="Configure").count() >= 1


def test_brewlate_header_buttons(brewlate_page):
    page = brewlate_page
    assert page.get_by_role("button", name="HISTORY").count() >= 1
    assert page.get_by_role("button", name="CLEAR KV").count() >= 1
    assert page.get_by_role("button", name="Utilities").count() >= 1
    assert page.locator(".brew-header-mode .mode-button").count() == 1


def test_brewlate_configure_engine_pills_and_launch(brewlate_page):
    page = brewlate_page
    for label in ("LLAMA", "MLX", "vLLM"):
        assert page.locator(".brew-engine-pill", has_text=label).count() >= 1
    brew_btn = page.locator(".brew-launch-btn")
    assert brew_btn.count() == 1
    assert brew_btn.inner_text().strip().upper() in ("BREW", "BREWING…")


def test_brewlate_utilities_menu_items(brewlate_page):
    page = brewlate_page
    page.get_by_role("button", name="Utilities").click()
    menu = page.locator(".brew-header-dropdown")
    page.wait_for_selector(".brew-header-dropdown", timeout=3_000)
    for label in (
        "Convert GGUF → MLX",
        "RAG Docs",
        "Response Cache",
        "Help (?)",
    ):
        assert menu.get_by_role("button", name=label).count() >= 1


def test_brewlate_no_matrix_monitor_tab(brewlate_page):
    """Monitor moved to left resource card — right tabs must not include Monitor."""
    page = brewlate_page
    tabs = page.locator(".brew-right-tab")
    if tabs.count() == 0:
        pytest.skip("Runtime tabs not visible (swarm offline / not deployed)")
    names = [tabs.nth(i).inner_text().strip() for i in range(tabs.count())]
    assert "Monitor" not in names
    for expected in ("Session", "Agents", "Modes", "Brewcast", "RAG"):
        assert expected in names


def test_brewlate_runtime_prompt_buttons(brewlate_page):
    page = brewlate_page
    if page.locator(".brew-right-tab").count() == 0:
        pytest.skip("Runtime panel not open")
    assert page.get_by_role("button", name="BREW").count() >= 1
    assert page.get_by_role("button", name="REFINE").count() >= 1
    assert page.get_by_role("button", name="llama").count() >= 1
    assert page.get_by_role("button", name="mlx").count() >= 1


def test_brewlate_left_monitor_popout(brewlate_page):
    page = brewlate_page
    trigger = page.locator(".brew-monitor-trigger")
    if trigger.count() == 0:
        pytest.skip("Monitor trigger not shown (no agents selected / offline configure)")
    trigger.first.click()
    popout = page.locator(".brew-monitor-popout")
    page.wait_for_selector(".brew-monitor-popout", timeout=3_000)
    assert popout.locator(".brew-res-kv-title", has_text="KV Cache").count() >= 1
    if page.locator(".brew-monitor-popout .brew-monitor-clear-btn").count():
        assert "Clear" in page.locator(".brew-monitor-popout .brew-monitor-clear-btn").first.inner_text()
    page.locator(".brew-monitor-popout-close").click()
    page.wait_for_timeout(200)
    assert page.locator(".brew-monitor-popout").count() == 0


def test_brewlate_body_layout_attribute(brewlate_page):
    attr = brewlate_page.evaluate("() => document.body.getAttribute('data-layout')")
    assert attr == "brewlate"
