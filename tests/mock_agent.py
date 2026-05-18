"""Minimal mock of llama-server's /v1/chat/completions for integration tests.

Each MockAgent runs a stdlib HTTP server on a dedicated port. It responds
with a canned message string that includes the agent name so tests can
verify which agent produced which output.

Failure injection: pass `fail=True` to make every request return HTTP 500.
Useful for exercising the circuit breaker.

Records the prompts it received in `.prompts_received` for assertion.

KV pressure support: set `.kv` to a KvState instance to serve realistic
/props, /slots, and /metrics responses for pressure_snapshot tests."""
import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import List


@dataclass
class SlotState:
    """Per-slot KV cache state, mirrors llama-server /slots response fields."""
    is_processing: bool = False
    cache_tokens: int = 0


@dataclass
class KvState:
    """Configurable KV pressure state served on /props, /slots, /metrics."""
    n_ctx: int = 4096
    slots: List[SlotState] = field(default_factory=lambda: [SlotState()])

    @property
    def total_slots(self) -> int:
        return len(self.slots)

    @property
    def slots_busy(self) -> int:
        return sum(1 for s in self.slots if s.is_processing)

    @property
    def kv_used_tokens(self) -> int:
        return sum(s.cache_tokens for s in self.slots)

    @property
    def usage_ratio(self) -> float:
        total_capacity = self.n_ctx * self.total_slots
        if total_capacity == 0:
            return 0.0
        return min(1.0, self.kv_used_tokens / total_capacity)

    def props_json(self) -> dict:
        return {
            "total_slots": self.total_slots,
            "default_generation_settings": {"n_ctx": self.n_ctx},
        }

    def slots_json(self) -> list:
        return [
            {"is_processing": s.is_processing, "cache_tokens": s.cache_tokens}
            for s in self.slots
        ]

    def metrics_text(self) -> str:
        lines = [
            f"llamacpp:kv_cache_usage_ratio {self.usage_ratio:.6f}",
            f"llamacpp:kv_cache_tokens {self.kv_used_tokens}",
            f"llamacpp:requests_processing {self.slots_busy}",
            "llamacpp:n_decode_total 0",
            "llamacpp:prompt_tokens_total 0",
            "llamacpp:tokens_predicted_total 0",
        ]
        return "\n".join(lines) + "\n"


class MockAgent:
    def __init__(self, name: str, port: int, fail: bool = False,
                 reply_template: str = "[{name}] received: {prompt_excerpt}"):
        self.name = name
        self.port = port
        self.fail = fail
        self.reply_template = reply_template
        self.prompts_received: list[str] = []
        # `fail_first_n`: fail the next N requests, then succeed. Resets to 0
        # when consumed. Used to test retry-on-transient-failure: e.g. set to
        # 1 and verify the second attempt succeeds without surfacing an error.
        self.fail_first_n: int = 0
        # Optional KV pressure state — if set, /props /slots /metrics are served.
        self.kv: KvState | None = None
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        agent = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args, **kwargs):
                pass  # silence default access log

            def _send_json(self, obj, status=200):
                body = json.dumps(obj).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                kv = agent.kv
                if kv is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                if self.path == '/props':
                    self._send_json(kv.props_json())
                elif self.path == '/slots':
                    self._send_json(kv.slots_json())
                elif self.path == '/metrics':
                    body = kv.metrics_text().encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                elif self.path == '/v1/models':
                    self._send_json({"object": "list", "data": [{"id": agent.name}]})
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8', errors='replace')
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError:
                    payload = {}
                # Extract last user message for the reply template.
                user_msg = ''
                for m in reversed(payload.get('messages', [])):
                    if m.get('role') == 'user':
                        user_msg = m.get('content', '')
                        break
                agent.prompts_received.append(user_msg)

                should_fail = agent.fail or agent.fail_first_n > 0
                if agent.fail_first_n > 0:
                    agent.fail_first_n -= 1
                if should_fail:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(b'{"error":{"message":"injected failure"}}')
                    return

                excerpt = user_msg[:60].replace('\n', ' ')
                content = agent.reply_template.format(name=agent.name, prompt_excerpt=excerpt)

                # Streaming mode mirrors llama-server's OpenAI-compatible
                # SSE: one `data: {choices:[{delta:{content:...}}]}` chunk per
                # token, terminated by `data: [DONE]`. We buffer the full
                # response and send Content-Length up front because httplib's
                # receiver-mode client expects the framing — Python's stdlib
                # http.server doesn't speak chunked transfer-encoding by
                # default, and an open-ended HTTP/1.0 close gets treated as a
                # connect failure on the C++ side.
                if payload.get('stream'):
                    parts = []
                    for tok in content.split(' '):
                        chunk = {'choices': [{'delta': {'content': tok + ' '}}]}
                        parts.append(f'data: {json.dumps(chunk)}\n\n'.encode('utf-8'))
                    parts.append(b'data: [DONE]\n\n')
                    full = b''.join(parts)
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.send_header('Content-Length', str(len(full)))
                    self.end_headers()
                    self.wfile.write(full)
                    self.wfile.flush()
                    return

                resp = {
                    'choices': [{'message': {'role': 'assistant', 'content': content}}],
                    'usage': {'completion_tokens': len(content.split())},
                }
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(resp).encode('utf-8'))

        self._server = HTTPServer(('127.0.0.1', self.port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        if self._thread:
            self._thread.join(timeout=2)

    def reset(self) -> None:
        self.prompts_received.clear()
