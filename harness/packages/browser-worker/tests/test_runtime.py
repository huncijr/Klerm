from __future__ import annotations

import unittest

import browser_use

from klerm_browser_worker.policy import READ_ONLY_ACTIONS, PolicyError
from klerm_browser_worker.runtime import ActiveRuntime, RuntimeConfigurationError, _field_names, safe_runtime_error


class RuntimeSecurityTests(unittest.TestCase):
    def test_pinned_browser_use_supports_fail_closed_configuration(self) -> None:
        agent_fields = _field_names(browser_use.Agent)
        agent_kwargs: dict[str, object] = {}
        runtime = object.__new__(ActiveRuntime)

        runtime._configure_read_only_tools(browser_use, browser_use.Agent, agent_fields, agent_kwargs)

        tools = agent_kwargs["tools"]
        actions = set(tools.registry.registry.actions)
        self.assertTrue({"navigate", "done"}.issubset(actions))
        self.assertTrue(actions.issubset(READ_ONLY_ACTIONS))

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


if __name__ == "__main__":
    unittest.main()
