"""
Контекст HTTP-запроса для журналов (ИБ-08, ИБ-09; docs/SECURITY_AUDIT_RF_2026-09-08.md).

Сквозной `request_id`, IP и User-Agent кладутся в ContextVar один раз на входе запроса —
их читают и форматтер логов (каждая строка лога несёт request_id), и журнал событий ИБ
(`audit_log.request_id/ip_address/user_agent`). Без этого по записи в audit_log нельзя найти
строки прикладного лога того же запроса — расследование инцидента разваливается на куски.

IP берётся из `X-Forwarded-For` ТОЛЬКО если запрос пришёл от доверенного прокси
(`TRUSTED_PROXIES`): иначе клиент подделывал бы свой IP одним заголовком, и анти-брутфорс
по паре «логин + IP» обходился бы тривиально.
"""
from __future__ import annotations

import ipaddress
import re
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.infrastructure.config import settings

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
client_ip_var: ContextVar[str | None] = ContextVar("client_ip", default=None)
user_agent_var: ContextVar[str | None] = ContextVar("user_agent", default=None)

# Входящий X-Request-ID принимаем только «безопасной» формы: иначе через него в логи
# протаскивался бы произвольный текст (подделка строк журнала, CRLF-инъекции).
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def _trusted(ip: str | None) -> bool:
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for net in settings.TRUSTED_PROXIES:
        try:
            if addr in ipaddress.ip_network(net, strict=False):
                return True
        except ValueError:
            continue
    return False


def resolve_client_ip(peer: str | None, forwarded_for: str | None) -> str | None:
    """Реальный IP клиента: первый адрес X-Forwarded-For, если соединение от доверенного прокси."""
    if forwarded_for and _trusted(peer):
        first = forwarded_for.split(",")[0].strip()
        try:
            ipaddress.ip_address(first)
            return first
        except ValueError:
            return peer
    return peer


class RequestContextMiddleware:
    """Чистый ASGI-middleware: заполняет ContextVar и отдаёт `X-Request-ID` в ответе."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        incoming = headers.get("x-request-id", "")
        rid = incoming if _SAFE_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        peer = scope.get("client")[0] if scope.get("client") else None
        tokens = (
            request_id_var.set(rid),
            client_ip_var.set(resolve_client_ip(peer, headers.get("x-forwarded-for"))),
            user_agent_var.set((headers.get("user-agent") or "")[:512] or None),
        )

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"].append((b"x-request-id", rid.encode("latin-1")))
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(tokens[0])
            client_ip_var.reset(tokens[1])
            user_agent_var.reset(tokens[2])
