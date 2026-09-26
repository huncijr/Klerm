from __future__ import annotations

import io
import json
import unittest
from unittest.mock import patch

from klerm_browser_worker.protocol import EventWriter, StartCommand, parse_command
from klerm_browser_worker.runtime import ActiveRuntime
from klerm_browser_worker.worker import Worker


class FakeBrowser:
    def __init__(self) -> None:
        self.closed = False

    async def stop(self) -> None:
        self.closed = True

    async def kill(self) -> None:
        self.closed = True


def start(run_id: str) -> StartCommand:
    command = parse_command(json.dumps({
        "version": 1,
        "command": "start",
        "request_id": f"request-{run_id}",
        "run_id": run_id,
        "task_id": f"task-{run_id}",
        "correlation_id": f"correlation-{run_id}",
        "agent_id": "browser-agent",
        "task": "What is on this page?",
        "model": "local-model",
        "base_url": "http://127.0.0.1:8080/v1",
        "token": "local-token",
        "allowed_origins": [],
    }))
    assert isinstance(command, StartCommand)
    return command


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_follow_up_reuses_browser_and_stop_closes_it(self) -> None:
        output = io.StringIO()
        worker = Worker(io.StringIO(), EventWriter(output))
        browser = FakeBrowser()
        seen: list[object | None] = []

        async def fake_agent(runtime: ActiveRuntime, _profile_dir: str) -> None:
            seen.append(runtime.browser)
            runtime.browser = browser
            runtime.event_writer.emit("run_completed", "completed", **runtime._run_fields(), result={
                "present": False, "length": 0, "sha256": None,
            })

        with patch.object(ActiveRuntime, "_run_agent", fake_agent):
            await worker._dispatch(start("run-1"))
            first_task = worker.run_task
            assert first_task is not None
            await first_task
            await worker._dispatch(start("run-2"))
            second_task = worker.run_task
            assert second_task is not None
            await second_task

        self.assertEqual(seen, [None, browser])
        self.assertIs(worker.browser, browser)
        await worker._shutdown(None)
        self.assertTrue(browser.closed)
        self.assertEqual([json.loads(line)["event"] for line in output.getvalue().splitlines()], [
            "command_accepted", "run_completed", "command_accepted", "run_completed", "shutdown",
        ])

    async def test_failed_browser_run_resets_profile_before_next_question(self) -> None:
        worker = Worker(io.StringIO(), EventWriter(io.StringIO()))
        browser = FakeBrowser()
        worker.browser = browser
        old_profile = worker.profile.name

        async def failing_agent(_runtime: ActiveRuntime, _profile_dir: str) -> None:
            raise RuntimeError("browser crashed")

        with patch.object(ActiveRuntime, "_run_agent", failing_agent):
            await worker._dispatch(start("run-1"))
            task = worker.run_task
            assert task is not None
            await task

        self.assertTrue(browser.closed)
        self.assertIsNone(worker.browser)
        self.assertNotEqual(worker.profile.name, old_profile)
        await worker._shutdown(None)


if __name__ == "__main__":
    unittest.main()
