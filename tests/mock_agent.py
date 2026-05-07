"""Minimal mock of llama-server's /v1/chat/completions for integration tests.

Each MockAgent runs a stdlib HTTP server on a dedicated port. It responds
with a canned message string that includes the agent name so tests can
verify which agent produced which output.

Failure injection: pass `fail=True` to make every request return HTTP 500.
Useful for exercising the circuit breaker.

Records the prompts it received in `.prompts_received` for assertion."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


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
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        agent = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args, **kwargs):
                pass  # silence default access log

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
