"""Credential-safe error normalization for the worker protocol."""

from __future__ import annotations

import re
from collections.abc import Iterable

_BEARER = re.compile(
    r"(?i)\b(bearer|token|api[_ -]?key|authorization)(?:\s*[:=]\s*|\s+)[^\s,;]+"
)
_URL_CREDENTIALS = re.compile(r"(?i)(https?://)[^/@\s]+@")
_SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*[^\s,;]+"
)


def redact_text(value: object, secrets: Iterable[str] = ()) -> str:
    """Return a bounded one-line error without known credential material."""

    text = str(value).replace("\r", " ").replace("\n", " ")
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    text = _URL_CREDENTIALS.sub(r"\1[REDACTED]@", text)
    text = _BEARER.sub(lambda match: f"{match.group(1)}=[REDACTED]", text)
    text = _SECRET_ASSIGNMENT.sub(lambda match: f"{match.group(1)}=[REDACTED]", text)
    return text[:500]
