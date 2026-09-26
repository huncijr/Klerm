from __future__ import annotations

import json
import io
import unittest

from klerm_browser_worker.protocol import (
    EventWriter,
    ProtocolError,
    ResumeCommand,
    StartCommand,
    TakeoverCommand,
    parse_command,
)


def valid_start(**changes: object) -> str:
    payload: dict[str, object] = {
        "version": 1,
        "command": "start",
        "request_id": "request-1",
        "run_id": "run-1",
        "task_id": "task-1",
        "correlation_id": "correlation-1",
        "agent_id": "agent-1",
        "task": "Read the public documentation.",
        "model": "local-model",
        "base_url": "http://127.0.0.1:8080/v1",
        "token": "local-token",
        "allowed_origins": ["https://example.com"],
    }
    payload.update(changes)
    return json.dumps(payload)


class ProtocolTests(unittest.TestCase):
    def test_parses_valid_start_and_normalizes_origins(self) -> None:
        command = parse_command(valid_start(allowed_origins=["https://EXAMPLE.com:443/"]))
        self.assertIsInstance(command, StartCommand)
        self.assertEqual(command.allowed_origins, ("https://example.com",))
        self.assertEqual(command.max_steps, 25)

    def test_rejects_unknown_fields(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "unknown field"):
            parse_command(valid_start(extra=True))

    def test_rejects_duplicate_fields(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "duplicate field"):
            parse_command('{"version":1,"version":1,"command":"shutdown","request_id":"r"}')

    def test_rejects_remote_llm_endpoint(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "loopback"):
            parse_command(valid_start(base_url="https://api.openai.com/v1"))

    def test_rejects_credentials_in_origin(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "credentials"):
            parse_command(valid_start(allowed_origins=["https://user:pass@example.com"]))

    def test_rejects_wrong_protocol_version(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "unsupported"):
            parse_command(valid_start(version=2))

    def test_accepts_empty_origin_allowlist_for_blank_start(self) -> None:
        command = parse_command(valid_start(allowed_origins=[]))
        self.assertIsInstance(command, StartCommand)
        self.assertEqual(command.allowed_origins, ())

    def test_events_have_monotonic_sequence_and_required_envelope(self) -> None:
        output = io.StringIO()
        writer = EventWriter(output)
        writer.emit("ready", "ready")
        writer.emit("shutdown", "completed")
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([event["sequence"] for event in events], [1, 2])
        for event in events:
            self.assertEqual(event["version"], 1)
            self.assertIn("timestamp", event)

    def test_parses_takeover_with_default_reason(self) -> None:
        command = parse_command(
            json.dumps({"version": 1, "command": "takeover", "request_id": "r", "run_id": "run-1"})
        )
        self.assertIsInstance(command, TakeoverCommand)
        assert isinstance(command, TakeoverCommand)
        self.assertEqual(command.reason, "Human takeover requested")

    def test_parses_takeover_with_explicit_reason(self) -> None:
        command = parse_command(
            json.dumps(
                {
                    "version": 1,
                    "command": "takeover",
                    "request_id": "r",
                    "run_id": "run-1",
                    "reason": "CAPTCHA handoff",
                }
            )
        )
        assert isinstance(command, TakeoverCommand)
        self.assertEqual(command.reason, "CAPTCHA handoff")

    def test_rejects_takeover_with_oversized_reason(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "reason"):
            parse_command(
                json.dumps(
                    {
                        "version": 1,
                        "command": "takeover",
                        "request_id": "r",
                        "run_id": "run-1",
                        "reason": "x" * 501,
                    }
                )
            )

    def test_rejects_takeover_with_unknown_fields(self) -> None:
        with self.assertRaisesRegex(ProtocolError, "unknown field"):
            parse_command(
                json.dumps(
                    {
                        "version": 1,
                        "command": "takeover",
                        "request_id": "r",
                        "run_id": "run-1",
                        "scope": "current_run",
                    }
                )
            )

    def test_parses_resume(self) -> None:
        command = parse_command(
            json.dumps({"version": 1, "command": "resume", "request_id": "r", "run_id": "run-1"})
        )
        self.assertIsInstance(command, ResumeCommand)


if __name__ == "__main__":
    unittest.main()
