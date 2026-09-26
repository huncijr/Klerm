"""Browser action and origin policy independent of browser-use internals."""

from __future__ import annotations

import asyncio
import ipaddress
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from urllib.parse import urlsplit
from urllib.parse import urljoin

READ_ONLY_ACTIONS = frozenset(
    {
        "close",
        "done",
        "extract",
        "find_elements",
        "find_text",
        "go_back",
        "navigate",
        "scroll",
        "search_page",
        "switch",
        "wait",
    }
)

# Only DOM targets whose behavior can be checked before dispatch are added here.
# Unknown controls, form submissions, credentials and downloads remain disabled.
INTERACTIVE_ACTIONS = frozenset({"click", "input", "select_dropdown", "send_keys", "dropdown_options"})
ALLOWED_ACTIONS = READ_ONLY_ACTIONS | INTERACTIVE_ACTIONS

class PolicyError(ValueError):
    pass


class RunStopped(Exception):
    pass


def normalize_origin(value: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise PolicyError("invalid origin") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PolicyError("origin must use http or https")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise PolicyError("origin must not contain credentials, query, or fragment")
    if parsed.path not in {"", "/"}:
        raise PolicyError("origin must not contain a path")
    host = parsed.hostname.rstrip(".").lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError as error:
            raise PolicyError("invalid origin hostname") from error
    else:
        raise PolicyError("IP address origins are blocked")
    default_port = 80 if parsed.scheme == "http" else 443
    host_text = f"[{host}]" if ":" in host else host
    return f"{parsed.scheme}://{host_text}" if port in {None, default_port} else f"{parsed.scheme}://{host_text}:{port}"


def origin_from_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise PolicyError("invalid navigation URL") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PolicyError("navigation URL must use http or https")
    if parsed.username or parsed.password:
        raise PolicyError("navigation URL must not contain credentials")
    host = parsed.hostname.rstrip(".").lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError as error:
            raise PolicyError("invalid navigation hostname") from error
    else:
        raise PolicyError("IP address navigation is blocked")
    default_port = 80 if parsed.scheme == "http" else 443
    host_text = f"[{host}]" if ":" in host else host
    return f"{parsed.scheme}://{host_text}" if port in {None, default_port} else f"{parsed.scheme}://{host_text}:{port}"


def validate_loopback_base_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError as error:
        raise PolicyError("invalid OpenAI base URL") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PolicyError("OpenAI base URL must use http or https")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise PolicyError("OpenAI base URL must not contain credentials, query, or fragment")
    host = parsed.hostname.rstrip(".").lower()
    is_loopback = host == "localhost"
    if not is_loopback:
        try:
            is_loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            is_loopback = False
    if not is_loopback:
        raise PolicyError("OpenAI base URL must target loopback")
    return value.rstrip("/")


def extract_actions(model_output: object) -> list[tuple[str, list[str]]]:
    """Extract action names and URL arguments without retaining other content."""

    raw_actions = getattr(model_output, "action", None)
    if raw_actions is None and isinstance(model_output, dict):
        raw_actions = model_output.get("action")
    if not isinstance(raw_actions, list):
        return []

    actions: list[tuple[str, list[str]]] = []
    for action in raw_actions:
        if hasattr(action, "model_dump"):
            action = action.model_dump(exclude_none=True)
        if not isinstance(action, dict) or len(action) != 1:
            raise PolicyError("browser produced an unrecognized action")
        name, arguments = next(iter(action.items()))
        if not isinstance(name, str):
            raise PolicyError("browser produced an invalid action name")
        urls: list[str] = []
        if isinstance(arguments, dict):
            candidate = arguments.get("url")
            if isinstance(candidate, str):
                urls.append(candidate)
        actions.append((name, urls))
    return actions


def check_interactive_target(name: str, arguments: dict[str, object], selector_map: object, page_url: str = "") -> str | None:
    """Return a link URL for origin approval, or deny opaque/mutating controls."""
    if not isinstance(selector_map, dict):
        raise PolicyError("browser DOM selector map is unavailable")
    index = arguments.get("index")
    if type(index) is not int or index < 0:
        raise PolicyError("browser interaction requires a DOM element index")
    node = selector_map.get(index)
    if node is None:
        raise PolicyError("browser interaction target is no longer available")
    attributes = getattr(node, "attributes", None)
    if not isinstance(attributes, dict):
        raise PolicyError("browser interaction target attributes are unavailable")
    tag = str(getattr(node, "node_name", "")).lower()
    if name == "input":
        role = str(attributes.get("role", "")).lower()
        input_type = str(attributes.get("type", "text")).lower()
        label = " ".join(str(attributes.get(key, "")) for key in ("aria-label", "placeholder", "name", "id")).lower()
        if tag != "input" or not (input_type == "search" or input_type == "text" and "search" in label or role == "searchbox"):
            raise PolicyError("only a recognized search field can be filled automatically")
        if not isinstance(arguments.get("text"), str) or len(arguments["text"]) > 2048:
            raise PolicyError("invalid search field text")
        return None
    if name == "click":
        if tag != "a" or getattr(node, "has_js_click_listener", False) or "download" in attributes:
            raise PolicyError("this browser control needs human interaction")
        href = attributes.get("href")
        if not isinstance(href, str):
            raise PolicyError("browser link has no HTTP target")
        target = urljoin(page_url, href)
        origin_from_url(target)
        if any(word in target.lower() for word in ("logout", "delete", "remove", "purchase", "checkout", "unsubscribe")):
            raise PolicyError("sensitive link requires human interaction")
        return target
    raise PolicyError("browser proposed an unsupported interactive action")


@dataclass
class OriginPolicy:
    initial_origins: Iterable[str]
    on_approval_required: Callable[[str], Awaitable[None]]
    allowed_for_run: set[str] = field(init=False)
    pending: dict[str, asyncio.Event] = field(default_factory=dict)
    stopped: asyncio.Event = field(default_factory=asyncio.Event)

    def __post_init__(self) -> None:
        self.allowed_for_run = {normalize_origin(origin) for origin in self.initial_origins}

    async def require(self, origin: str) -> None:
        normalized = origin_from_url(origin)
        if normalized in self.allowed_for_run:
            return

        approval = self.pending.get(normalized)
        if approval is None:
            approval = asyncio.Event()
            self.pending[normalized] = approval
            await self.on_approval_required(normalized)
        approval_task = asyncio.create_task(approval.wait())
        stop_task = asyncio.create_task(self.stopped.wait())
        done, pending = await asyncio.wait(
            {approval_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        if stop_task in done:
            raise RunStopped

    def approve(self, origin: str, scope: str) -> str:
        normalized = normalize_origin(origin)
        approval = self.pending.get(normalized)
        if approval is None:
            raise PolicyError("origin is not awaiting approval")
        if scope == "current_run":
            self.allowed_for_run.add(normalized)
        elif scope == "allow_once":
            pass
        else:
            raise PolicyError("approval scope must be allow_once or current_run")
        del self.pending[normalized]
        approval.set()
        return normalized

    def stop(self) -> None:
        self.stopped.set()
        for approval in self.pending.values():
            approval.set()
        self.pending.clear()


def browser_allowed_domains(origins: Iterable[str]) -> list[str]:
    patterns: set[str] = set()
    for origin in origins:
        # The pinned Browser Use security watchdog treats scheme-qualified
        # entries as string prefixes. Appending /* keeps the match scoped to
        # the exact scheme, host, and port instead of matching lookalike hosts.
        patterns.add(f"{normalize_origin(origin)}/*")
    return sorted(patterns)
