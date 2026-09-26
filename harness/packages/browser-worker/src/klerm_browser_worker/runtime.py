"""Lazy browser-use integration with fail-closed security configuration."""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import inspect
import logging
import os
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from .policy import (
    READ_ONLY_ACTIONS,
    OriginPolicy,
    PolicyError,
    RunStopped,
    browser_allowed_domains,
    extract_actions,
    origin_from_url,
)
from .protocol import EventWriter, StartCommand
from .redaction import redact_text

# browser-use reads these during import. Keep this block above every dynamic
# browser-use import.
os.environ["ANONYMIZED_TELEMETRY"] = "false"
os.environ["BROWSER_USE_TELEMETRY"] = "false"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["BROWSER_USE_LOGGING_LEVEL"] = "critical"

logging.disable(logging.CRITICAL)


class RuntimeConfigurationError(RuntimeError):
    pass


def safe_runtime_error(error: BaseException, secrets: tuple[str, ...] = ()) -> str:
    if isinstance(error, (PolicyError, RuntimeConfigurationError)):
        return redact_text(error, secrets)
    return f"browser runtime failed ({type(error).__name__})"


def _field_names(target: object) -> set[str]:
    model_fields = getattr(target, "model_fields", None)
    if isinstance(model_fields, dict):
        return set(model_fields)
    try:
        signature = inspect.signature(target)
    except (TypeError, ValueError):
        return set()
    return {
        name
        for name, parameter in signature.parameters.items()
        if name != "self" and parameter.kind not in {parameter.VAR_KEYWORD, parameter.VAR_POSITIONAL}
    }


def _require_field(fields: set[str], *choices: str) -> str:
    for choice in choices:
        if choice in fields:
            return choice
    raise RuntimeConfigurationError(f"browser-use lacks required security setting: {choices[0]}")


def _maybe_await(value: object) -> Awaitable[object] | None:
    return value if inspect.isawaitable(value) else None


@dataclass
class ActiveRuntime:
    command: StartCommand
    policy: OriginPolicy
    event_writer: EventWriter
    on_finished: Callable[[], None]
    profile_dir: str = ""
    agent: Any = None
    browser: Any = None
    stopped: bool = False
    terminal_emitted: bool = False
    once_domains_to_remove: set[str] = field(default_factory=set)
    takeover_reason: str | None = None
    control_granted: bool = False
    resume_signal: asyncio.Event = field(default_factory=asyncio.Event)
    stop_signal: asyncio.Event = field(default_factory=asyncio.Event)

    async def run(self) -> None:
        try:
            await self._run_agent(self.profile_dir)
        except RunStopped:
            self.terminal_emitted = True
            self.event_writer.emit("run_stopped", "stopped", **self._run_fields())
        except BaseException as error:
            if self.stopped:
                self.terminal_emitted = True
                self.event_writer.emit("run_stopped", "stopped", **self._run_fields())
            else:
                await self._close_browser()
                self.browser = None
                self.terminal_emitted = True
                self.event_writer.emit(
                    "run_failed",
                    "failed",
                    **self._run_fields(),
                    error=safe_runtime_error(error, (self.command.token, self.command.task)),
                )
        finally:
            self.on_finished()

    async def _run_agent(self, profile_dir: str) -> None:
        browser_use = importlib.import_module("browser_use")
        Agent = getattr(browser_use, "Agent", None)
        Browser = getattr(browser_use, "Browser", None)
        ChatOpenAI = getattr(browser_use, "ChatOpenAI", None)
        BrowserProfile = getattr(browser_use, "BrowserProfile", None)
        if not all((Agent, Browser, ChatOpenAI, BrowserProfile)):
            raise RuntimeConfigurationError("browser-use 0.13.10 API is unavailable")

        profile_fields = _field_names(BrowserProfile)
        profile_kwargs: dict[str, object] = {
            _require_field(profile_fields, "headless"): False,
            _require_field(profile_fields, "user_data_dir"): profile_dir,
            _require_field(profile_fields, "keep_alive"): True,
            _require_field(profile_fields, "disable_security"): False,
            _require_field(profile_fields, "enable_default_extensions"): False,
            _require_field(profile_fields, "permissions"): [],
            _require_field(profile_fields, "accept_downloads"): False,
            _require_field(profile_fields, "auto_download_pdfs"): False,
            _require_field(profile_fields, "cross_origin_iframes"): False,
            _require_field(profile_fields, "block_ip_addresses"): True,
            _require_field(profile_fields, "captcha_solver"): False,
            _require_field(profile_fields, "allowed_domains"): browser_allowed_domains(
                self.policy.allowed_for_run
            ),
        }
        sandbox_field = _require_field(profile_fields, "chromium_sandbox", "sandbox")
        profile_kwargs[sandbox_field] = True
        if "downloads_path" in profile_fields:
            profile_kwargs["downloads_path"] = None
        elif "allow_downloads" in profile_fields:
            profile_kwargs["allow_downloads"] = False
        else:
            raise RuntimeConfigurationError("browser-use lacks required security setting: downloads")
        if self.browser is None:
            profile = BrowserProfile(**profile_kwargs)
            browser_fields = _field_names(Browser)
            profile_field = _require_field(browser_fields, "browser_profile", "profile")
            self.browser = Browser(**{profile_field: profile})
        else:
            profile = getattr(self.browser, "browser_profile", None)
            if profile is None or not isinstance(getattr(profile, "allowed_domains", None), list):
                raise RuntimeConfigurationError("browser profile cannot reset origin permissions")
            current_url = await self.browser.get_current_page_url()
            if current_url.startswith(("http://", "https://")):
                self.policy.allowed_for_run.add(origin_from_url(current_url))
            profile.allowed_domains[:] = browser_allowed_domains(self.policy.allowed_for_run)

        llm_fields = _field_names(ChatOpenAI)
        llm_kwargs = {
            _require_field(llm_fields, "model"): self.command.model,
            _require_field(llm_fields, "base_url"): self.command.base_url,
            _require_field(llm_fields, "api_key"): self.command.token,
            _require_field(llm_fields, "frequency_penalty"): None,
            _require_field(llm_fields, "add_schema_to_system_prompt"): True,
            _require_field(llm_fields, "dont_force_structured_output"): True,
            _require_field(llm_fields, "max_retries"): 0,
        }
        llm = ChatOpenAI(**llm_kwargs)

        agent_fields = _field_names(Agent)
        agent_kwargs: dict[str, object] = {
            _require_field(agent_fields, "task"): self._read_only_task(),
            _require_field(agent_fields, "llm"): llm,
            _require_field(agent_fields, "browser", "browser_session"): self.browser,
            _require_field(agent_fields, "use_vision"): False,
            _require_field(agent_fields, "use_judge"): False,
            _require_field(agent_fields, "enable_signal_handler"): False,
            _require_field(agent_fields, "display_files_in_done_text"): False,
        }
        self._configure_read_only_tools(browser_use, Agent, agent_fields, agent_kwargs)
        callback_field = _require_field(agent_fields, "register_new_step_callback")
        agent_kwargs[callback_field] = self._step_callback
        self.agent = Agent(**agent_kwargs)

        self.event_writer.emit("run_started", "running", **self._run_fields())
        run_fields = _field_names(self.agent.run)
        run_kwargs: dict[str, object] = {}
        if "max_steps" in run_fields:
            run_kwargs["max_steps"] = self.command.max_steps
        else:
            raise RuntimeConfigurationError("browser-use run lacks max_steps")
        history = await self.agent.run(**run_kwargs)
        final_result = None
        with suppress(Exception):
            final_result = history.final_result()
        result_text = final_result if isinstance(final_result, str) else ""
        self.terminal_emitted = True
        self.event_writer.emit(
            "run_completed",
            "completed",
            **self._run_fields(),
            result={
                "present": bool(result_text),
                "length": len(result_text),
                "sha256": hashlib.sha256(result_text.encode("utf-8")).hexdigest()
                if result_text
                else None,
            },
        )

    def _configure_read_only_tools(
        self,
        browser_use: object,
        Agent: object,
        agent_fields: set[str],
        agent_kwargs: dict[str, object],
    ) -> None:
        tool_class = getattr(browser_use, "Tools", None)
        if tool_class is None or "tools" not in agent_fields:
            raise RuntimeConfigurationError("browser-use cannot configure read-only tools")
        tools = tool_class()
        registry = getattr(getattr(tools, "registry", None), "registry", None)
        actions = getattr(registry, "actions", None)
        exclude_action = getattr(tools, "exclude_action", None)
        if not isinstance(actions, dict) or not callable(exclude_action):
            raise RuntimeConfigurationError("browser-use cannot enforce a read-only action allowlist")
        for action_name in tuple(actions):
            if action_name not in READ_ONLY_ACTIONS:
                exclude_action(action_name)
        remaining = set(actions)
        if not {"navigate", "done"}.issubset(remaining) or not remaining.issubset(READ_ONLY_ACTIONS):
            raise RuntimeConfigurationError("browser-use read-only action allowlist is incomplete")
        agent_kwargs["tools"] = tools

    async def _step_callback(self, *args: object, **_kwargs: object) -> None:
        if self.stopped:
            raise RunStopped
        await self._drain_takeover()
        if self.stopped:
            raise RunStopped
        self._remove_consumed_once_domains()
        model_output = next(
            (
                arg
                for arg in args
                if getattr(arg, "action", None) is not None
                or (isinstance(arg, dict) and arg.get("action") is not None)
            ),
            None,
        )
        if model_output is None:
            return
        actions = extract_actions(model_output)
        action_names: list[str] = []
        for action_name, urls in actions:
            if action_name not in READ_ONLY_ACTIONS:
                raise PolicyError("browser proposed a non-read-only action")
            action_names.append(action_name)
            for url in urls:
                await self.policy.require(url)
        self.event_writer.emit(
            "step_planned",
            "running",
            **self._run_fields(),
            actions=action_names,
        )

    async def _drain_takeover(self) -> None:
        """Pause AI stepping while a human owns the browser.

        A dispatched browser action cannot be retroactively cancelled, so a
        takeover takes effect at the next step boundary: the in-flight action
        drains, then `control_granted` is emitted and the agent waits. Resume
        arriving before the grant is consumed immediately so the wire order
        stays granted-before-resumed or resumed-only, never a stale grant.
        """
        if self.takeover_reason is None:
            return
        if self.resume_signal.is_set():
            reason = self.takeover_reason
            self._clear_takeover()
            self.event_writer.emit("control_resumed", "running", **self._run_fields(), reason=reason)
            return
        if not self.control_granted:
            self.control_granted = True
            self.event_writer.emit(
                "control_granted", "paused", **self._run_fields(), reason=self.takeover_reason
            )
        resume_task = asyncio.create_task(self.resume_signal.wait())
        stop_task = asyncio.create_task(self.stop_signal.wait())
        done, pending = await asyncio.wait(
            {resume_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        if stop_task in done or self.stopped:
            raise RunStopped
        reason = self.takeover_reason or ""
        self._clear_takeover()
        self.event_writer.emit("control_resumed", "running", **self._run_fields(), reason=reason)

    def _clear_takeover(self) -> None:
        self.takeover_reason = None
        self.control_granted = False
        self.resume_signal.clear()

    def request_takeover(self, reason: str) -> bool:
        """Request human control. Returns True on a new request, False if already held."""
        if self.stopped:
            raise PolicyError("browser run is stopping")
        if self.takeover_reason is not None:
            return False
        if not reason or len(reason) > 500:
            raise PolicyError("takeover reason must be 1 through 500 characters")
        self.takeover_reason = reason
        return True

    def resume(self) -> None:
        """Return control to the agent. The next step re-observes the page."""
        if self.stopped:
            raise PolicyError("browser run is stopping")
        if self.takeover_reason is None:
            raise PolicyError("no human takeover is active")
        self.resume_signal.set()

    async def stop(self) -> None:
        self.stopped = True
        self.stop_signal.set()
        self.resume_signal.set()
        self.policy.stop()
        if self.agent is not None:
            for method_name in ("stop", "pause"):
                method = getattr(self.agent, method_name, None)
                if method is None:
                    continue
                with suppress(Exception):
                    pending = _maybe_await(method())
                    if pending is not None:
                        await pending
                break

    async def _close_browser(self) -> None:
        if self.browser is None:
            return
        for method_name in ("kill", "close", "stop"):
            method = getattr(self.browser, method_name, None)
            if method is None:
                continue
            with suppress(Exception):
                pending = _maybe_await(method())
                if pending is not None:
                    await pending
            break

    def approve_origin(self, origin: str, scope: str) -> str:
        normalized = self.policy.approve(origin, scope)
        profile = getattr(self.browser, "browser_profile", None)
        if profile is None:
            profile = getattr(self.browser, "profile", None)
        allowed_domains = getattr(profile, "allowed_domains", None)
        domains = browser_allowed_domains([normalized])
        if isinstance(allowed_domains, list):
            for domain in domains:
                if domain not in allowed_domains:
                    allowed_domains.append(domain)
            if scope == "allow_once":
                self.once_domains_to_remove.update(domains)
        return normalized

    def _remove_consumed_once_domains(self) -> None:
        if not self.once_domains_to_remove:
            return
        profile = getattr(self.browser, "browser_profile", None)
        if profile is None:
            profile = getattr(self.browser, "profile", None)
        allowed_domains = getattr(profile, "allowed_domains", None)
        if isinstance(allowed_domains, list):
            persistent_domains = set(browser_allowed_domains(self.policy.allowed_for_run))
            allowed_domains[:] = [
                domain
                for domain in allowed_domains
                if domain not in self.once_domains_to_remove or domain in persistent_domains
            ]
        self.once_domains_to_remove.clear()

    def _read_only_task(self) -> str:
        return (
            "Operate in strict read-only mode. Use only direct navigation, tab management, "
            "scrolling, text extraction, waiting, and completion. Never click controls, fill "
            "or submit forms, upload or download files, read the clipboard, handle credentials, "
            "change an account, purchase, publish, delete, or bypass access controls.\n\n"
            f"Requested task:\n{self.command.task}"
        )

    def _run_fields(self) -> dict[str, str]:
        return {
            "run_id": self.command.run_id,
            "task_id": self.command.task_id,
            "correlation_id": self.command.correlation_id,
            "agent_id": self.command.agent_id,
        }
