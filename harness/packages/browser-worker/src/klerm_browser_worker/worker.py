"""Async command dispatcher for one isolated browser run at a time."""

from __future__ import annotations

import asyncio
from typing import TextIO

from . import __version__
from .policy import OriginPolicy, PolicyError
from .protocol import (
    PROTOCOL_VERSION,
    ApproveOriginCommand,
    Command,
    EventWriter,
    ProtocolError,
    ShutdownCommand,
    StartCommand,
    StopCommand,
    parse_command,
)
from .redaction import redact_text
from .runtime import ActiveRuntime


class Worker:
    def __init__(self, input_stream: TextIO, event_writer: EventWriter) -> None:
        self.input_stream = input_stream
        self.events = event_writer
        self.active: ActiveRuntime | None = None
        self.run_task: asyncio.Task[None] | None = None
        self.shutting_down = False

    async def serve(self) -> None:
        self.events.emit(
            "ready",
            "ready",
            protocol_version=PROTOCOL_VERSION,
            worker_version=__version__,
        )
        while not self.shutting_down:
            line = await asyncio.to_thread(self.input_stream.readline)
            if line == "":
                await self._shutdown(None)
                break
            if not line.strip():
                self._reject(None, "empty command")
                continue
            command: Command | None = None
            try:
                command = parse_command(line)
                await self._dispatch(command)
            except (ProtocolError, PolicyError) as error:
                request_id = command.request_id if command is not None else None
                self._reject(request_id, redact_text(error))

    async def _dispatch(self, command: Command) -> None:
        if isinstance(command, StartCommand):
            if self.active is not None:
                self._reject(command.request_id, "a browser run is already active")
                return

            async def approval_required(origin: str) -> None:
                self.events.emit(
                    "origin_approval_required",
                    "paused",
                    **self._run_fields(command),
                    origin=origin,
                    choices=["allow_once", "current_run"],
                )

            policy = OriginPolicy(command.allowed_origins, approval_required)

            def finished() -> None:
                self.active = None
                self.run_task = None

            self.active = ActiveRuntime(command, policy, self.events, finished)
            self.events.emit(
                "command_accepted",
                "accepted",
                request_id=command.request_id,
                command="start",
                **self._run_fields(command),
            )
            self.run_task = asyncio.create_task(self.active.run())
            return
        if isinstance(command, ApproveOriginCommand):
            active = self._matching_run(command.request_id, command.run_id)
            if active is None:
                return
            normalized = active.approve_origin(command.origin, command.scope)
            self.events.emit(
                "origin_approved",
                "accepted",
                request_id=command.request_id,
                **self._run_fields(active.command),
                origin=normalized,
                scope=command.scope,
            )
            return
        if isinstance(command, StopCommand):
            active = self._matching_run(command.request_id, command.run_id)
            if active is None:
                return
            self.events.emit(
                "command_accepted",
                "accepted",
                request_id=command.request_id,
                command="stop",
                **self._run_fields(active.command),
            )
            await active.stop()
            return
        if isinstance(command, ShutdownCommand):
            await self._shutdown(command.request_id)

    def _matching_run(self, request_id: str, run_id: str) -> ActiveRuntime | None:
        if self.active is None or self.active.command.run_id != run_id:
            self._reject(request_id, "run is not active")
            return None
        return self.active

    async def _shutdown(self, request_id: str | None) -> None:
        self.shutting_down = True
        if self.active is not None:
            await self.active.stop()
        if self.run_task is not None:
            try:
                await asyncio.wait_for(self.run_task, timeout=10)
            except TimeoutError:
                self.run_task.cancel()
        self.events.emit("shutdown", "completed", request_id=request_id)

    def _reject(self, request_id: str | None, reason: str) -> None:
        self.events.emit(
            "command_rejected",
            "rejected",
            request_id=request_id,
            error=reason,
        )

    @staticmethod
    def _run_fields(command: StartCommand) -> dict[str, str]:
        return {
            "run_id": command.run_id,
            "task_id": command.task_id,
            "correlation_id": command.correlation_id,
            "agent_id": command.agent_id,
        }
