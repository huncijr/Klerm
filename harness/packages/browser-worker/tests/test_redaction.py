from __future__ import annotations

import unittest

from klerm_browser_worker.redaction import redact_text


class RedactionTests(unittest.TestCase):
    def test_redacts_known_secret_and_common_credentials(self) -> None:
        value = (
            "Bearer abc123 token=xyz password=hunter2 "
            "https://user:pass@example.com/path supplied-secret"
        )
        redacted = redact_text(value, ["supplied-secret"])
        for secret in ("abc123", "xyz", "hunter2", "user:pass", "supplied-secret"):
            self.assertNotIn(secret, redacted)
        self.assertIn("[REDACTED]", redacted)

    def test_flattens_and_bounds_errors(self) -> None:
        redacted = redact_text("first\nsecond" + "x" * 1000)
        self.assertNotIn("\n", redacted)
        self.assertLessEqual(len(redacted), 500)


if __name__ == "__main__":
    unittest.main()
