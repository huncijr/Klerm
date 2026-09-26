from __future__ import annotations

import asyncio
import io
import json
import unittest
from types import SimpleNamespace

from klerm_browser_worker.policy import OriginPolicy, PolicyError, RunStopped
from klerm_browser_worker.protocol import EventWriter, StartCommand
from klerm_browser_worker.runtime import ActiveRuntime


def make_runtime(output: io.StringIO) -> ActiveRuntime:
    command = StartCommand(
        request_id="request-1",
        run_id="run-1",
        task_id="task-1",
        correlation_id="correlation-1",
        agent_id="agent-1",
        task="Read the public documentation.",
        model="local-model",
        base_url="http://127.0.0.1:8080/v1",
        token="local-token",
        allowed_origins=("https://example.com",),
        max_steps=25,
    )

    async def on_required(_origin: str) -> None:
        raise AssertionError("no approval expected in control tests")

    return ActiveRuntime(command, OriginPolicy([], on_required), EventWriter(output), lambda: None)


def read_events(output: io.StringIO) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.getvalue().splitlines() if line.strip()]


async def wait_for_event(output: io.StringIO, name: str) -> None:
    for _ in range(200):
        if any(event.get("event") == name for event in read_events(output)):
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"timed out waiting for {name}")


class ControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_takeover_pauses_step_callback_until_resume(self) -> None:
        output = io.StringIO()
        runtime = make_runtime(output)
        self.assertTrue(runtime.request_takeover("Human takeover requested"))
        self.assertFalse(runtime.request_takeover("Human takeover requested"))

        callback = asyncio.create_task(runtime._step_callback({"action": []}))
        await wait_for_event(output, "control_granted")
        self.assertFalse(callback.done())

        runtime.resume()
        await asyncio.wait_for(callback, timeout=5)

        names = [event.get("event") for event in read_events(output)]
        self.assertEqual(names, ["control_granted", "control_resumed"])
        granted = read_events(output)[0]
        self.assertEqual(granted["status"], "paused")
        self.assertEqual(granted["reason"], "Human takeover requested")
        self.assertIsNone(runtime.takeover_reason)
        self.assertFalse(runtime.control_granted)

    async def test_resume_before_grant_consumes_immediately(self) -> None:
        output = io.StringIO()
        runtime = make_runtime(output)
        runtime.request_takeover("Pointer shake takeover gesture")
        runtime.resume()
        await asyncio.wait_for(runtime._step_callback({"action": []}), timeout=5)

        names = [event.get("event") for event in read_events(output)]
        self.assertEqual(names, ["control_resumed"])

    async def test_resume_discards_stale_navigation_and_replans(self) -> None:
        output = io.StringIO()
        runtime = make_runtime(output)
        planned = {"action": [{"navigate": {"url": "https://example.com/"}}]}
        runtime.request_takeover("Human changed the browser page")
        runtime.resume()
        await runtime._step_callback(planned)
        self.assertEqual(planned["action"], [])
        self.assertEqual([event["event"] for event in read_events(output)], ["control_resumed"])

    async def test_human_selected_origin_needs_approval_before_replanning(self) -> None:
        output = io.StringIO()
        runtime = make_runtime(output)
        requested: list[str] = []

        async def on_required(origin: str) -> None:
            requested.append(origin)
            runtime.policy.approve(origin, "current_run")

        runtime.policy = OriginPolicy([], on_required)

        class FakeBrowser:
            browser_profile = SimpleNamespace(allowed_domains=[])

            async def get_current_page_url(self) -> str:
                return "https://other.example.com/new-page"

        runtime.browser = FakeBrowser()
        planned = {"action": [{"navigate": {"url": "https://old.example.com/"}}]}
        runtime.request_takeover("Human navigation")
        runtime.resume()
        await runtime._step_callback(planned)
        self.assertEqual(requested, ["https://other.example.com"])
        self.assertEqual(runtime.browser.browser_profile.allowed_domains, ["https://other.example.com/*"])
        self.assertEqual(planned["action"], [])

    async def test_resume_without_takeover_is_rejected(self) -> None:
        runtime = make_runtime(io.StringIO())
        with self.assertRaises(PolicyError):
            runtime.resume()

    async def test_takeover_with_invalid_reason_is_rejected(self) -> None:
        runtime = make_runtime(io.StringIO())
        with self.assertRaises(PolicyError):
            runtime.request_takeover("")
        with self.assertRaises(PolicyError):
            runtime.request_takeover("x" * 501)

    async def test_stop_during_pause_raises_run_stopped(self) -> None:
        output = io.StringIO()
        runtime = make_runtime(output)
        runtime.request_takeover("Human takeover requested")
        callback = asyncio.create_task(runtime._step_callback({"action": []}))
        await wait_for_event(output, "control_granted")
        await runtime.stop()
        with self.assertRaises(RunStopped):
            await asyncio.wait_for(callback, timeout=5)


if __name__ == "__main__":
    unittest.main()
