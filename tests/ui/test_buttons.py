"""Matrix UI smoke tests — Brewlate and Classic (Playwright).

Requires:
  - Dev server: npm start  →  http://localhost:3000
  - Playwright: pip install playwright && playwright install chromium

Override URL:
  MATRIX_UI_URL=http://127.0.0.1:3000/?layout=brewlate
  MATRIX_CLASSIC_URL=http://127.0.0.1:3000/?layout=classic
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
LAYOUTS = REPO / "src" / "layouts"

# Brewlate was split across layout modules; static checks scan the tree.
_BREWLATE_LAYOUT_FILES = (
    "BrewlateLayout.js",
    "useBrewConfig.js",
    "BrewConfigPanel.js",
    "BrewRightPanel.js",
    "BrewSessionTab.js",
    "BrewBroadcastTab.js",
)


def _brewlate_layout_sources() -> str:
    return "\n".join(
        (LAYOUTS / name).read_text()
        for name in _BREWLATE_LAYOUT_FILES
        if (LAYOUTS / name).is_file()
    )
BREWLATE_URL = os.environ.get(
    "MATRIX_UI_URL",
    "http://localhost:3000/?layout=brewlate&theme=dark",
)
CLASSIC_URL = os.environ.get(
    "MATRIX_CLASSIC_URL",
    "http://localhost:3000/?layout=classic&theme=dark",
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
        "brew-agents-popout-trigger",
        "brew-agents-bulk-btn",
        "brew-agent-card-check",
    ):
        assert marker in src or marker in css


def test_brewlate_prompt_uses_brew_labels():
    src = _brewlate_layout_sources()
    assert 'submitLabel="BREW"' in src
    assert 'qualityPassLabel="REFINE"' in src


# ── Playwright (live UI) ────────────────────────────────────────────────────


def _dismiss_dev_overlay(page) -> None:
    """CRA/webpack compile overlay blocks Playwright clicks when present."""
    page.evaluate(
        """() => {
          const el = document.getElementById('webpack-dev-server-client-overlay');
          if (el) el.remove();
        }"""
    )


def _port_open(host: str, port: int, timeout: float = 0.4) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        try:
            s.connect((host, port))
            return True
        except OSError:
            return False


def _wait_classic_kv_gauge(page, timeout_ms: int = 20_000) -> None:
    """KvPressureGauge renders only after coordinator is online and KV poll returns."""
    if not _port_open("127.0.0.1", 8000):
        pytest.skip("Coordinator :8000 offline — classic header hides KV gauge")
    page.wait_for_selector(".kv-gauge, .kv-gauge--err", timeout=timeout_ms)


@pytest.fixture(scope="module")
def playwright_browser():
    if not HAS_PLAYWRIGHT:
        pytest.skip("playwright not installed — pip install playwright && playwright install chromium")
    if not _port_open("127.0.0.1", 3000):
        pytest.skip("UI dev server not running on :3000 — start with `npm start`")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture(scope="module")
def brewlate_page(playwright_browser):
    page = playwright_browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BREWLATE_URL, wait_until="domcontentloaded", timeout=45_000)
    page.wait_for_selector(".layout-brewlate", timeout=20_000)
    _dismiss_dev_overlay(page)
    page.wait_for_timeout(2_500)
    yield page
    page.close()


def test_brewlate_shell_and_branding(brewlate_page):
    page = brewlate_page
    assert page.locator(".brew-logo").inner_text() == "Brewlatte"
    assert page.locator(".brew-panel-title", has_text="Configure").count() >= 1


def test_brewlate_header_buttons(brewlate_page):
    page = brewlate_page
    assert page.get_by_role("button", name="HISTORY").count() >= 1
    assert page.get_by_role("button", name="CLEAR KV").count() >= 1
    assert page.get_by_role("button", name="Utilities").count() >= 1
    assert page.locator(".brew-header-mode .mode-button").count() == 1


def test_brewlate_agent_selection_all_none_and_toggle(brewlate_page):
    page = brewlate_page
    cards = page.locator(".brew-panel--left .brew-agent-card[role='button']")
    if cards.count() < 2:
        pytest.skip("Need at least two configure agent cards")
    page.locator(".brew-agents-bulk-btn", has_text="None").click()
    page.wait_for_timeout(150)
    selected_none = page.locator(".brew-panel--left .brew-agent-card.selected").count()
    assert selected_none == 0
    page.locator(".brew-agents-bulk-btn", has_text="All").click()
    page.wait_for_timeout(200)
    selected_all = page.locator(".brew-panel--left .brew-agent-card.selected").count()
    assert selected_all == cards.count()
    first = cards.first
    first.click()
    page.wait_for_timeout(150)
    assert selected_all - 1 == page.locator(".brew-panel--left .brew-agent-card.selected").count()
    badge = page.locator(".brew-panel-badge").first.inner_text().lower()
    assert "custom" in badge


def test_brewlate_profile_preset_then_custom_override(brewlate_page):
    page = brewlate_page
    select = page.locator(".brew-profile-select")
    if select.count() == 0:
        pytest.skip("Profile select not visible")
    cards = page.locator(".brew-panel--left .brew-agent-card[role='button']")
    select.select_option("safe")
    page.wait_for_timeout(300)
    safe_count = page.locator(".brew-panel--left .brew-agent-card.selected").count()
    assert safe_count >= 1
    assert safe_count <= cards.count()
    select.select_option("custom")
    page.wait_for_timeout(150)
    cards.first.click()
    page.wait_for_timeout(150)
    assert "custom" in page.locator(".brew-panel-badge").first.inner_text().lower()


def test_brewlate_configure_engine_pills_and_launch(brewlate_page):
    page = brewlate_page
    for label in ("LLAMA", "MLX", "vLLM"):
        assert page.locator(".brew-engine-pill", has_text=label).count() >= 1
    brew_btn = page.locator(".brew-launch-btn")
    assert brew_btn.count() == 1
    assert brew_btn.inner_text().strip().upper() in ("BREW", "BREWING…")


def test_brewlate_launch_button_disabled_without_agents(brewlate_page):
    page = brewlate_page
    brew_btn = page.locator(".brew-launch-btn")
    page.locator(".brew-agents-bulk-btn", has_text="None").click()
    page.wait_for_timeout(200)
    assert brew_btn.is_disabled()


def test_brewlate_launch_button_enabled_after_select_all(brewlate_page):
    page = brewlate_page
    brew_btn = page.locator(".brew-launch-btn")
    page.locator(".brew-agents-bulk-btn", has_text="All").click()
    page.wait_for_timeout(400)
    assert not brew_btn.is_disabled()


def test_brewlate_launch_click_shows_brewing_state(brewlate_page):
    page = brewlate_page
    page.locator(".brew-agents-bulk-btn", has_text="All").click()
    page.wait_for_timeout(300)
    brew_btn = page.locator(".brew-launch-btn")
    if brew_btn.is_disabled():
        pytest.skip("No models assigned — cannot test Brew click")
    brew_btn.click()
    page.wait_for_timeout(300)
    label = brew_btn.inner_text().strip().upper()
    assert label in ("BREW", "BREWING…")
    status = page.locator(".brew-deploy-status")
    if status.count():
        assert len(status.first.inner_text().strip()) > 0


def test_brewlate_code_results_region_on_session_tab(brewlate_page):
    page = brewlate_page
    page.locator(".brew-agents-bulk-btn", has_text="All").click()
    page.wait_for_timeout(200)
    if not page.locator(".brew-launch-btn").first.is_disabled():
        page.locator(".brew-launch-btn").click()
        page.wait_for_timeout(600)
    if page.locator(".brew-right-tab").count() == 0:
        pytest.skip("Runtime tabs not visible")
    page.locator(".brew-right-tab", has_text="Session").first.click()
    page.wait_for_timeout(200)
    assert page.locator(".brew-session-tab").count() >= 1
    assert page.locator(".brew-session-scroll").count() >= 1


def test_brewlate_prompt_and_codegen_ui_wiring(brewlate_page):
    page = brewlate_page
    page.locator(".brew-agents-bulk-btn", has_text="All").click()
    page.wait_for_timeout(200)
    brew_btn = page.locator(".brew-launch-btn")
    if not brew_btn.is_disabled():
        brew_btn.click()
        page.wait_for_timeout(800)
    textarea = page.locator(".brew-session-prompt .prompt-textarea, .prompt-textarea").first
    if textarea.count() == 0:
        pytest.skip("Prompt area not visible — swarm not deployed in UI state")
    assert "prompt" in (textarea.get_attribute("placeholder") or "").lower()
    assert page.get_by_role("button", name="BREW").count() >= 1
    assert page.get_by_role("button", name="REFINE").count() >= 1
    textarea.fill("write hello world in python")
    offline = "OFFLINE" in page.locator(".brew-status-pill").first.inner_text().upper()
    brew_submit = page.get_by_role("button", name="BREW").first
    if offline:
        assert brew_submit.is_disabled()
    else:
        assert brew_submit.inner_text().strip().upper() in ("BREW", "BREWING…")


def test_classic_prompt_broadcast_wiring(classic_page):
    page = classic_page
    configure = page.get_by_role("button", name="CONFIGURE")
    if configure.count() and configure.first.is_visible():
        configure.first.click()
        page.wait_for_timeout(300)
    textarea = page.locator(".prompt-textarea")
    if textarea.count() == 0:
        pytest.skip("Classic runtime prompt not visible")
    assert page.get_by_role("button", name="BROADCAST").count() >= 1
    assert "prompt" in (textarea.first.get_attribute("placeholder") or "").lower()


def test_classic_launch_swarm_button(classic_page):
    page = classic_page
    configure = page.get_by_role("button", name="CONFIGURE")
    if configure.count():
        configure.first.click()
        page.wait_for_timeout(400)
    launch = page.get_by_role("button", name="LAUNCH SWARM")
    if launch.count() == 0:
        pytest.skip("LAUNCH SWARM not visible")
    assert launch.first.is_visible()


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
    for expected in ("Session", "Agents", "Modes", "Live", "RAG"):
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
    assert popout.locator(".brew-res-layout-title", has_text="Port Pressure").count() >= 1
    assert popout.locator(".pcluster").count() >= 1
    if page.locator(".brew-monitor-popout .brew-monitor-clear-btn").count():
        assert "Clear" in page.locator(".brew-monitor-popout .brew-monitor-clear-btn").first.inner_text()
    page.locator(".brew-monitor-popout-close").click()
    page.wait_for_timeout(200)
    assert page.locator(".brew-monitor-popout").count() == 0


def test_brewlate_body_layout_attribute(brewlate_page):
    attr = brewlate_page.evaluate("() => document.body.getAttribute('data-layout')")
    assert attr == "brewlate"


def test_brewlate_agents_budgets_popout(brewlate_page):
    page = brewlate_page
    trigger = page.locator(".brew-agents-popout-trigger")
    assert trigger.count() >= 1
    trigger.first.click()
    page.wait_for_selector(".brew-agents-popout", timeout=3_000)
    assert page.locator(".brew-agents-popout", has_text="TOKEN BUDGETS").count() >= 1
    page.locator(".brew-agents-popout .brew-header-btn").first.click()
    page.wait_for_timeout(200)
    assert page.locator(".brew-agents-popout").count() == 0


# ── Classic (Matrix) parity ───────────────────────────────────────────────────


@pytest.fixture(scope="module")
def classic_page(playwright_browser):
    page = playwright_browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(CLASSIC_URL, wait_until="domcontentloaded", timeout=45_000)
    page.wait_for_selector(".matrix-container", timeout=20_000)
    _dismiss_dev_overlay(page)
    page.wait_for_timeout(2_500)
    yield page
    page.close()


def test_classic_shell_and_branding(classic_page):
    page = classic_page
    assert page.locator("h1").inner_text().startswith("Swarm Matrix")
    assert page.get_by_role("button", name="CONFIGURE").count() >= 1


def test_classic_header_parity_with_brewlate(classic_page):
    page = classic_page
    assert page.get_by_role("button", name="HISTORY").count() >= 1
    assert page.get_by_role("button", name="CLEAR KV").count() >= 1
    _wait_classic_kv_gauge(page)
    assert page.locator(".mode-button").count() >= 1


def test_classic_runtime_broadcast_labels(classic_page):
    page = classic_page
    configure = page.get_by_role("button", name="CONFIGURE")
    if configure.count() and configure.first.is_visible():
        configure.first.click()
        page.wait_for_timeout(300)
    broadcast = page.get_by_role("button", name="BROADCAST")
    if broadcast.count() == 0:
        pytest.skip("Runtime not visible — coordinator offline or still on CONFIGURE")
    assert broadcast.count() >= 1
    assert page.get_by_role("button", name="QUALITY PASS").count() >= 1


def test_classic_swarm_config_token_budgets(classic_page):
    page = classic_page
    configure = page.get_by_role("button", name="CONFIGURE")
    if configure.count():
        configure.first.click()
        page.wait_for_timeout(500)
    assert page.locator(".swarm-config", has_text="TOKEN BUDGETS").count() >= 1


def test_classic_body_layout_attribute(classic_page):
    attr = classic_page.evaluate("() => document.body.getAttribute('data-layout')")
    assert attr == "classic"


# ── MS-29-4 additions — orchestrate progress indicator ───────────────────────

def test_brewlate_orchestrate_progress_class_exists():
    """Brew broadcast tab renders .brew-brewcast-phase when orchestrate is running."""
    src = _brewlate_layout_sources()
    assert "brew-brewcast-phase" in src
