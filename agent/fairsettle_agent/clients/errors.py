class ClientError(Exception):
    """Base of every client failure. Messages never contain credentials."""

    def __init__(
        self,
        service: str,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        request_id: str | None = None,
        retryable: bool = False,
    ) -> None:
        self.service = service
        self.message = message
        self.status = status
        self.code = code
        self.request_id = request_id
        self.retryable = retryable
        super().__init__(f"{service}: {message}")


class Unavailable(ClientError):
    def __init__(
        self,
        service: str,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        request_id: str | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(
            service, message, status=status, code=code,
            request_id=request_id, retryable=True,
        )


class Unauthorized(ClientError):
    pass


class NotFound(ClientError):
    pass


class Forbidden(ClientError):
    pass


class ServiceError(ClientError):
    pass


class MalformedResponse(ClientError):
    pass


class UnrecordedRequest(ClientError):
    pass
