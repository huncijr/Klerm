from __future__ import annotations

import unittest
import io
import json
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import browser_use

from klerm_browser_worker.policy import ALLOWED_ACTIONS, PolicyError, check_interactive_target
from klerm_browser_worker.policy import OriginPolicy
from klerm_browser_worker.protocol import EventWriter, StartCommand
from klerm_browser_worker.runtime import ActiveRuntime, RuntimeConfigurationError, _field_names, safe_runtime_error


class RuntimeSecurityTests(unittest.TestCase):
    def test_interactions_allow_search_input_and_public_links_only(self) -> None:
        search = SimpleNamespace(node_name="INPUT", attributes={"type": "search"})
        link = SimpleNamespace(node_name="A", attributes={"href": "https://example.org/news"}, has_js_click_listener=False)
        controls = {1: search, 2: link}
        self.assertIsNone(check_interactive_target("input", {"index": 1, "text": "news"}, controls))
        self.assertEqual(check_interactive_target("click", {"index": 2}, controls), "https://example.org/news")
        with self.assertRaises(PolicyError):
            check_interactive_target("input", {"index": 2, "text": "secret"}, controls)
        with self.assertRaises(PolicyError):
            check_interactive_target("click", {"index": 2}, {2: SimpleNamespace(node_name="A", attributes={"href": "https://example.org/delete"})})
        with self.assertRaises(PolicyError):
            check_interactive_target("click", {"index": 2}, {2: SimpleNamespace(node_name="BUTTON", attributes={})})

    def test_pinned_browser_use_supports_fail_closed_configuration(self) -> None:
        agent_fields = _field_names(browser_use.Agent)
        agent_kwargs: dict[str, object] = {}
        runtime = object.__new__(ActiveRuntime)

        runtime._configure_read_only_tools(browser_use, browser_use.Agent, agent_fields, agent_kwargs)

        tools = agent_kwargs["tools"]
        actions = set(tools.registry.registry.actions)
        self.assertTrue({"navigate", "done"}.issubset(actions))
        self.assertTrue({"click", "input"}.issubset(actions))
        self.assertTrue(actions.issubset(ALLOWED_ACTIONS))

        llm_fields = _field_names(browser_use.ChatOpenAI)
        self.assertTrue(
            {
                "add_schema_to_system_prompt",
                "api_key",
                "base_url",
                "dont_force_structured_output",
                "frequency_penalty",
                "max_retries",
                "model",
            }.issubset(llm_fields)
        )

        profile_fields = _field_names(browser_use.BrowserProfile)
        self.assertTrue(
            {
                "accept_downloads",
                "allowed_domains",
                "auto_download_pdfs",
                "block_ip_addresses",
                "captcha_solver",
                "chromium_sandbox",
                "cross_origin_iframes",
                "disable_security",
                "enable_default_extensions",
                "headless",
                "permissions",
                "user_data_dir",
            }.issubset(profile_fields)
        )

        # Keep the private-method smoke independent of browser launch and model calls.
        self.assertIsInstance(tools, browser_use.Tools)

    def test_untrusted_runtime_error_body_is_not_emitted(self) -> None:
        message = safe_runtime_error(RuntimeError("<html>private page body</html> token=secret"))
        self.assertEqual(message, "browser runtime failed (RuntimeError)")

    def test_controlled_errors_are_redacted(self) -> None:
        self.assertEqual(
            safe_runtime_error(RuntimeConfigurationError("missing supplied-token"), ("supplied-token",)),
            "missing [REDACTED]",
        )
        self.assertEqual(
            safe_runtime_error(PolicyError("browser proposed a non-read-only action")),
            "browser proposed a non-read-only action",
        )


class NavigationTests(unittest.IsolatedAsyncioTestCase):
    async def test_human_verification_control_requires_takeover_not_approval(self) -> None:
        output = io.StringIO()
        command = StartCommand(
            request_id="request-1", run_id="run-1", task_id="task-1", correlation_id="correlation-1",
            agent_id="browser-agent", task="open", model="test-model", base_url="http://127.0.0.1:8080/v1",
            token="local-token", allowed_origins=("https://example.org",), max_steps=2,
        )
        async def approval_required(_origin: str) -> None:
            raise AssertionError("unexpected origin approval")
        node = SimpleNamespace(node_name="BUTTON", attributes={"aria-label": "I am not a robot"})
        state = SimpleNamespace(url="https://example.org/", dom_state=SimpleNamespace(selector_map={1: node}))
        model_output = {"action": [{"click": {"index": 1}}]}
        active = ActiveRuntime(command, OriginPolicy(command.allowed_origins, approval_required),
                               EventWriter(output), lambda: None)
        task = asyncio.create_task(active._step_callback(state, model_output, 1))
        for _ in range(10):
            await asyncio.sleep(0)
            if active.control_granted:
                break
        self.assertTrue(active.control_granted)
        self.assertEqual(model_output["action"], [])
        self.assertEqual([json.loads(line)["event"] for line in output.getvalue().splitlines()], ["control_granted"])
        active.resume()
        await task

    async def test_action_dispatch_and_settlement_are_logged_without_arguments(self) -> None:
        output = io.StringIO()
        command = StartCommand(
            request_id="request-1", run_id="run-1", task_id="task-1", correlation_id="correlation-1",
            agent_id="browser-agent", task="search", model="test-model", base_url="http://127.0.0.1:8080/v1",
            token="local-token", allowed_origins=("https://example.org",), max_steps=2,
        )
        async def approval_required(_origin: str) -> None:
            raise AssertionError("unexpected origin approval")

        active = ActiveRuntime(command, OriginPolicy(command.allowed_origins, approval_required),
                               EventWriter(output), lambda: None)
        kwargs: dict[str, object] = {}
        with patch.object(browser_use.Tools, "act", new_callable=AsyncMock) as execute:
            execute.return_value = SimpleNamespace(error=None)
            active._configure_read_only_tools(browser_use, browser_use.Agent, _field_names(browser_use.Agent), kwargs)
            action = SimpleNamespace(model_dump=lambda **_options: {"input": {"index": 1, "text": "secret-query"}})
            await kwargs["tools"].act(action)
        self.assertEqual([json.loads(line)["event"] for line in output.getvalue().splitlines()],
                         ["action_dispatched", "action_settled"])
        self.assertNotIn("secret-query", output.getvalue())

    async def test_button_click_waits_for_explicit_approval_and_denial_discards_action(self) -> None:
        output = io.StringIO()
        command = StartCommand(
            request_id="request-1", run_id="run-1", task_id="task-1", correlation_id="correlation-1",
            agent_id="browser-agent", task="click", model="test-model", base_url="http://127.0.0.1:8080/v1",
            token="local-token", allowed_origins=("https://example.org",), max_steps=2,
        )
        async def approval_required(_origin: str) -> None:
            raise AssertionError("unexpected origin approval")

        button = SimpleNamespace(node_name="BUTTON", attributes={}, snapshot_node=None)
        state = SimpleNamespace(url="https://example.org/", dom_state=SimpleNamespace(selector_map={1: button}))
        active = ActiveRuntime(command, OriginPolicy(command.allowed_origins, approval_required),
                               EventWriter(output), lambda: None)
        proposed = {"action": [{"click": {"index": 1}}]}
        task = asyncio.create_task(active._step_callback(state, proposed, 1))
        await asyncio.sleep(0)
        self.assertEqual(active.pending_action_id, "action-1")
        self.assertEqual(json.loads(output.getvalue().splitlines()[0])["event"], "action_approval_required")
        active.approve_action("action-1", "denied")
        await task
        self.assertEqual(proposed["action"], [])
        with self.assertRaises(PolicyError):
            active.approve_action("action-1", "approved")

        proposed = {"action": [{"click": {"index": 1}}]}
        task = asyncio.create_task(active._step_callback(state, proposed, 2))
        await asyncio.sleep(0)
        active.approve_action("action-2", "approved")
        await task
        self.assertEqual(proposed["action"], [{"click": {"index": 1}}])

    async def test_search_field_action_emits_target_cursor_without_search_text(self) -> None:
        output = io.StringIO()
        command = StartCommand(
            request_id="request-1", run_id="run-1", task_id="task-1", correlation_id="correlation-1",
            agent_id="browser-agent", task="search", model="test-model", base_url="http://127.0.0.1:8080/v1",
            token="local-token", allowed_origins=("https://example.org",), max_steps=2,
        )
        async def approval_required(_origin: str) -> None:
            raise AssertionError("unexpected origin approval")

        rect = SimpleNamespace(x=20, y=30, width=100, height=40)
        search = SimpleNamespace(node_name="INPUT", attributes={"type": "search"},
                                 snapshot_node=SimpleNamespace(clientRects=rect))
        state = SimpleNamespace(dom_state=SimpleNamespace(selector_map={1: search}))
        model_output = {"action": [{"input": {"index": 1, "text": "private-search-term"}}]}
        active = ActiveRuntime(command, OriginPolicy(command.allowed_origins, approval_required),
                               EventWriter(output), lambda: None)
        await active._step_callback(state, model_output, 1)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(events[0]["actions"], ["input"])
        self.assertEqual(events[0]["cursor"], {"x": 70, "y": 50, "action": "input"})
        self.assertNotIn("private-search-term", output.getvalue())

    async def test_explicit_start_navigates_before_agent_completes(self) -> None:
        actions: list[str] = []
        output = io.StringIO()
        command = StartCommand(
            request_id="request-1", run_id="run-1", task_id="task-1", correlation_id="correlation-1",
            agent_id="browser-agent", task="nyisd meg a youtubeot", model="test-model",
            base_url="http://127.0.0.1:8080/v1", token="local-token",
            allowed_origins=("https://www.youtube.com",), max_steps=2,
            start_url="https://www.youtube.com/",
            cdp_url="http://127.0.0.1:9321",
        )

        class FakeBrowser:
            def __init__(self, browser_profile: object) -> None:
                self.browser_profile = browser_profile
                assert getattr(browser_profile, "cdp_url") == "http://127.0.0.1:9321"

            async def start(self) -> None:
                actions.append("start")

            async def navigate_to(self, url: str) -> None:
                actions.append(f"navigate:{url}")

        class FakeChat:
            def __init__(self, model: str, base_url: str, api_key: str, frequency_penalty: object,
                         add_schema_to_system_prompt: bool, dont_force_structured_output: bool,
                         max_retries: int) -> None:
                pass

        class FakeAgent:
            def __init__(self, task: str, llm: object, browser: object, use_vision: bool,
                         use_judge: bool, enable_signal_handler: bool, display_files_in_done_text: bool,
                         tools: object, register_new_step_callback: object) -> None:
                pass

            async def run(self, max_steps: int) -> object:
                actions.append("agent")
                return type("History", (), {"final_result": lambda self: None})()

        async def on_approval_required(_origin: str) -> None:
            raise AssertionError("unexpected origin approval")

        active = ActiveRuntime(command, OriginPolicy(command.allowed_origins, on_approval_required),
                               EventWriter(output), lambda: None, profile_dir="/tmp/klerm-test-browser")
        with patch.object(browser_use, "Browser", FakeBrowser), patch.object(browser_use, "Agent", FakeAgent), \
                patch.object(browser_use, "ChatOpenAI", FakeChat):
            await active._run_agent(active.profile_dir)

        self.assertEqual(actions, ["start", "navigate:https://www.youtube.com/", "agent"])
        self.assertEqual([json.loads(line)["event"] for line in output.getvalue().splitlines()],
                         ["run_started", "navigation", "run_completed"])


if __name__ == "__main__":
    unittest.main()
