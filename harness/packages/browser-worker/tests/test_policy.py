from __future__ import annotations

import asyncio
import unittest

from klerm_browser_worker.policy import (
    OriginPolicy,
    PolicyError,
    extract_actions,
    browser_allowed_domains,
    normalize_origin,
    origin_from_url,
    validate_loopback_base_url,
)


class PolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_normalizes_origin_without_path_or_default_port(self) -> None:
        self.assertEqual(normalize_origin("https://Example.COM:443/"), "https://example.com")

    def test_rejects_non_origin_url(self) -> None:
        with self.assertRaisesRegex(PolicyError, "path"):
            normalize_origin("https://example.com/private")

    def test_rejects_ip_address_origins_and_navigation(self) -> None:
        with self.assertRaisesRegex(PolicyError, "IP address"):
            normalize_origin("https://192.0.2.1")
        with self.assertRaisesRegex(PolicyError, "IP address"):
            origin_from_url("https://[2001:db8::1]/page")

    def test_extracts_origin_from_navigation_url_without_exposing_path(self) -> None:
        self.assertEqual(
            origin_from_url("https://Example.com:443/private?q=secret#fragment"),
            "https://example.com",
        )

    def test_loopback_validation_accepts_ipv4_ipv6_and_localhost(self) -> None:
        for value in (
            "http://127.0.0.1:8000/v1",
            "http://[::1]:8000/v1",
            "https://localhost/v1",
        ):
            with self.subTest(value=value):
                self.assertEqual(validate_loopback_base_url(value), value)

    def test_extract_actions_keeps_only_names_and_urls(self) -> None:
        output = {
            "action": [
                {"navigate": {"url": "https://example.com", "secret": "do-not-retain"}},
                {"scroll": {"amount": 500}},
            ]
        }
        self.assertEqual(
            extract_actions(output),
            [("navigate", ["https://example.com"]), ("scroll", [])],
        )

    def test_browser_allowlist_uses_exact_origin_patterns(self) -> None:
        self.assertEqual(
            browser_allowed_domains(["https://example.com", "https://example.com:8443"]),
            ["https://example.com/*", "https://example.com:8443/*"],
        )

    async def test_unknown_origin_pauses_until_current_run_approval(self) -> None:
        requested: list[str] = []

        async def on_required(origin: str) -> None:
            requested.append(origin)

        policy = OriginPolicy([], on_required)
        pending = asyncio.create_task(policy.require("https://example.com"))
        await asyncio.sleep(0)
        self.assertEqual(requested, ["https://example.com"])
        self.assertFalse(pending.done())
        policy.approve("https://example.com", "current_run")
        await pending
        await policy.require("https://example.com")

    async def test_allow_once_is_consumed(self) -> None:
        requested: list[str] = []

        async def on_required(origin: str) -> None:
            requested.append(origin)

        policy = OriginPolicy([], on_required)
        first = asyncio.create_task(policy.require("https://example.com"))
        await asyncio.sleep(0)
        policy.approve("https://example.com", "allow_once")
        await first
        second = asyncio.create_task(policy.require("https://example.com"))
        await asyncio.sleep(0)
        self.assertEqual(len(requested), 2)
        policy.stop()
        with self.assertRaises(Exception):
            await second


if __name__ == "__main__":
    unittest.main()
