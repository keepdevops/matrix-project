"""Minimal SSE client for the test suite.

Posts a JSON body to a streaming endpoint and yields parsed
{event, data} dicts as they arrive. Stops when an event named `done` is
received or when the server closes the connection."""
import http.client
import json
from typing import Iterator


def stream_events(host: str, port: int, path: str,
                  body: dict, timeout: float = 30.0) -> Iterator[dict]:
    payload = json.dumps(body).encode('utf-8')
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        conn.request('POST', path, body=payload, headers={
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
        })
        resp = conn.getresponse()
        if resp.status != 200:
            raise RuntimeError(f"stream open failed: HTTP {resp.status}")

        # Each SSE frame is a sequence of `field: value\n` lines, terminated by
        # a blank line. We accumulate fields until the blank line, then yield.
        event_name = None
        data_parts: list[str] = []
        buf = b''
        while True:
            chunk = resp.read1(4096) if hasattr(resp, 'read1') else resp.read(4096)
            if not chunk:
                break
            buf += chunk
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                line = line.rstrip(b'\r').decode('utf-8', errors='replace')
                if line == '':
                    if event_name or data_parts:
                        data_str = '\n'.join(data_parts)
                        try:
                            data = json.loads(data_str) if data_str else None
                        except json.JSONDecodeError:
                            data = data_str
                        yield {'event': event_name or 'message', 'data': data}
                        if event_name == 'done':
                            return
                        event_name = None
                        data_parts = []
                elif line.startswith('event:'):
                    event_name = line[6:].lstrip()
                elif line.startswith('data:'):
                    data_parts.append(line[5:].lstrip())
                # ignore other field types (id:, retry:)
    finally:
        conn.close()


def collect_events(host: str, port: int, path: str, body: dict,
                   timeout: float = 30.0) -> list[dict]:
    return list(stream_events(host, port, path, body, timeout))
