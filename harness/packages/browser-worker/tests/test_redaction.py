from __future__ import annotations

import unittest

from klerm_browser_worker.redaction import redact_text


class RedactionTests(unittest.TestCase):
    def test_long_final_answer_retains_paragraphs_and_redacts_credentials(self) -> None:
        answer = "1. First post\n" + "Observed content. " * 100 + "\n10. Final post password=secret"
        result = redact_text(answer, maximum=32_000, multiline=True)
        self.assertIn("10. Final post", result)
        self.assertIn("\n", result)
        self.assertNotIn("password=secret", result)
        self.assertGreater(len(result), 500)

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
