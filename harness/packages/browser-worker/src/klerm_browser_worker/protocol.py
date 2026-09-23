"""Strict JSONL command parsing and normalized event output."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TextIO

from .policy import PolicyError, normalize_origin, validate_loopback_base_url

PROTOCOL_VERSION = 1
MAX_LINE_BYTES = 1_048_576
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class ProtocolError(ValueError):
    pass


def _object_no_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError(f"duplicate field: {key}")
        result[key] = value
    return result


def _strict_fields(payload: dict[str, object], required: set[str], optional: set[str] = set()) -> None:
    missing = required - payload.keys()
    unknown = payload.keys() - required - optional
    if missing:
        raise ProtocolError(f"missing field: {sorted(missing)[0]}")
    if unknown:
        raise ProtocolError(f"unknown field: {sorted(unknown)[0]}")


def _string(payload: dict[str, object], key: str, *, maximum: int, allow_empty: bool = False) -> str:
    value = payload[key]
    if not isinstance(value, str) or (not allow_empty and not value) or len(value) > maximum:
        raise ProtocolError(f"invalid field: {key}")
    return value


def _identifier(payload: dict[str, object], key: str) -> str:
    value = _string(payload, key, maximum=128)
    if not _ID.fullmatch(value):
        raise ProtocolError(f"invalid field: {key}")
    return value


@dataclass(frozen=True)
class StartCommand:
    request_id: str
    run_id: str
    task_id: str
    correlation_id: str
    agent_id: str
    task: str
    model: str
    base_url: str
    token: str
    allowed_origins: tuple[str, ...]
    max_steps: int


@dataclass(frozen=True)
class ApproveOriginCommand:
    request_id: str
    run_id: str
    origin: str
    scope: str


@dataclass(frozen=True)
class StopCommand:
    request_id: str
    run_id: str


@dataclass(frozen=True)
class ShutdownCommand:
    request_id: str


Command = StartCommand | ApproveOriginCommand | StopCommand | ShutdownCommand


def parse_command(line: str) -> Command:
    if len(line.encode("utf-8")) > MAX_LINE_BYTES:
        raise ProtocolError("command exceeds maximum size")
    try:
        payload = json.loads(line, object_pairs_hook=_object_no_duplicates)
    except ProtocolError:
        raise
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ProtocolError("invalid JSON") from error
    if not isinstance(payload, dict):
        raise ProtocolError("command must be a JSON object")
    if payload.get("version") != PROTOCOL_VERSION:
        raise ProtocolError("unsupported protocol version")
    command = payload.get("command")
    if command == "start":
        required = {
            "version",
            "command",
            "request_id",
            "run_id",
            "task_id",
            "correlation_id",
            "agent_id",
            "task",
            "model",
            "base_url",
            "token",
            "allowed_origins",
        }
        _strict_fields(payload, required, {"max_steps"})
        origins = payload["allowed_origins"]
        if not isinstance(origins, list) or not 1 <= len(origins) <= 64 or not all(isinstance(item, str) for item in origins):
            raise ProtocolError("invalid field: allowed_origins")
        max_steps = payload.get("max_steps", 25)
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or not 1 <= max_steps <= 100:
            raise ProtocolError("invalid field: max_steps")
        try:
            normalized_origins = tuple(dict.fromkeys(normalize_origin(item) for item in origins))
            base_url = validate_loopback_base_url(_string(payload, "base_url", maximum=2048))
        except PolicyError as error:
            raise ProtocolError(str(error)) from error
        return StartCommand(
            request_id=_identifier(payload, "request_id"),
            run_id=_identifier(payload, "run_id"),
            task_id=_identifier(payload, "task_id"),
            correlation_id=_identifier(payload, "correlation_id"),
            agent_id=_identifier(payload, "agent_id"),
            task=_string(payload, "task", maximum=32_768),
            model=_string(payload, "model", maximum=256),
            base_url=base_url,
            token=_string(payload, "token", maximum=8192),
            allowed_origins=normalized_origins,
            max_steps=max_steps,
        )
    if command == "approve_origin":
        _strict_fields(
            payload,
            {"version", "command", "request_id", "run_id", "origin", "scope"},
        )
        try:
            origin = normalize_origin(_string(payload, "origin", maximum=2048))
        except PolicyError as error:
            raise ProtocolError(str(error)) from error
        scope = _string(payload, "scope", maximum=16)
        if scope not in {"allow_once", "current_run"}:
            raise ProtocolError("invalid field: scope")
        return ApproveOriginCommand(
            request_id=_identifier(payload, "request_id"),
            run_id=_identifier(payload, "run_id"),
            origin=origin,
            scope=scope,
        )
    if command == "stop":
        _strict_fields(payload, {"version", "command", "request_id", "run_id"})
        return StopCommand(
            request_id=_identifier(payload, "request_id"),
            run_id=_identifier(payload, "run_id"),
        )
    if command == "shutdown":
        _strict_fields(payload, {"version", "command", "request_id"})
        return ShutdownCommand(request_id=_identifier(payload, "request_id"))
    raise ProtocolError("unknown command")


class EventWriter:
    def __init__(self, stream: TextIO) -> None:
        self._stream = stream
        self._sequence = 0

    def emit(self, event: str, status: str, **fields: object) -> None:
        self._sequence += 1
        payload = {
            "version": PROTOCOL_VERSION,
            "sequence": self._sequence,
            "event": event,
            "status": status,
            "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            **fields,
        }
        self._stream.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
        self._stream.flush()
