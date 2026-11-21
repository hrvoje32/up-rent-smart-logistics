"""Small ASGI middleware for bounded local optimization request bodies."""

from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.models import MAX_REQUEST_BODY_BYTES


class RequestBodyLimitMiddleware:
    """Reject oversized optimization requests before Pydantic or OR-Tools processing."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self._is_optimization_request(scope):
            await self.app(scope, receive, send)
            return
        if self._content_length_is_allowed(scope):
            await self._run_with_stream_limit(scope, receive, send)
            return
        await self._too_large_response(scope, receive, send)

    @staticmethod
    def _is_optimization_request(scope: Scope) -> bool:
        return (
            scope["type"] == "http"
            and scope["method"] == "POST"
            and scope["path"] == "/api/v1/optimize"
        )

    @staticmethod
    def _content_length_is_allowed(scope: Scope) -> bool:
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is None:
            return True
        try:
            return int(content_length) <= MAX_REQUEST_BODY_BYTES
        except ValueError:
            return False

    async def _run_with_stream_limit(self, scope: Scope, receive: Receive, send: Send) -> None:
        received_bytes = 0

        async def limited_receive() -> Message:
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > MAX_REQUEST_BODY_BYTES:
                    raise RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestBodyTooLarge:
            await self._too_large_response(scope, receive, send)

    @staticmethod
    async def _too_large_response(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            status_code=413,
            content={"detail": "Optimization request body exceeds the configured limit."},
        )
        await response(scope, receive, send)


class RequestBodyTooLarge(Exception):
    """Private control-flow exception used before endpoint execution."""

