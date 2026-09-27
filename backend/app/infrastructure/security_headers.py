"""
Заголовки безопасности HTTP-ответов API (ИБ-13; SEC-06 в docs/SECURITY_AUDIT_RF_2026-09-08.md).

API отдаёт JSON и файлы выгрузок, HTML не рендерит — поэтому политика жёсткая:
`default-src 'none'; frame-ancestors 'none'`. Исключение — Swagger UI (`/docs`), если он
включён (`API_DOCS_ENABLED`): ему нужны скрипты и стили с CDN, иначе страница пустая.

HSTS выставляется только для HTTPS-запросов (напрямую или через доверенный прокси по
`X-Forwarded-Proto`): на голом HTTP заголовок бессмыслен, а на localhost «прилипал» бы к
браузеру разработчика. Для периметра те же заголовки продублированы в infra/Caddyfile и
frontend/nginx.conf — браузер получает их и для статики фронта, а не только для API.

`Cache-Control: no-store` на всём /api: ответы содержат токены и ПДн, им не место в кэше
браузера и промежуточных прокси.
"""
from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.infrastructure.config import settings

API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
# Swagger UI FastAPI грузит swagger-ui-bundle с cdn.jsdelivr.net и вставляет inline-скрипт.
DOCS_CSP = (
    "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
)

COMMON_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # same-site, а не same-origin: фронт на :3000 и API на :8000 одного хоста — один сайт.
    "Cross-Origin-Resource-Policy": "same-site",
}
HSTS = "max-age=31536000; includeSubDomains"


def headers_for(path: str, https: bool) -> dict[str, str]:
    """Набор заголовков для ответа по пути запроса. Чистая функция — проверяется тестом."""
    out = dict(COMMON_HEADERS)
    is_docs = path in ("/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json")
    out["Content-Security-Policy"] = DOCS_CSP if is_docs else API_CSP
    if path.startswith("/api/"):
        out["Cache-Control"] = "no-store"
        out["Pragma"] = "no-cache"
    if https and settings.SECURITY_HSTS_ENABLED:
        out["Strict-Transport-Security"] = HSTS
    return out


class SecurityHeadersMiddleware:
    """Чистый ASGI-middleware: дописывает заголовки, не перетирая выставленные обработчиком."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        req_headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        https = scope.get("scheme") == "https" or req_headers.get("x-forwarded-proto", "").lower() == "https"
        extra = headers_for(scope.get("path", ""), https)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {k.decode("latin-1").lower() for k, _ in message.get("headers", [])}
                message.setdefault("headers", [])
                for name, value in extra.items():
                    if name.lower() not in existing:
                        message["headers"].append((name.encode("latin-1"), value.encode("latin-1")))
            await send(message)

        await self.app(scope, receive, send_with_headers)
