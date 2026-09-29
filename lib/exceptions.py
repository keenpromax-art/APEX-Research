class AppError(Exception):
    """Base class for all application errors with user-visible messages."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class InvalidTickerError(AppError):
    def __init__(self, ticker: str):
        super().__init__(f"Invalid ticker format: '{ticker}'.", status_code=400)


class TickerNotFoundError(AppError):
    def __init__(self, ticker: str):
        super().__init__(f"Unable to retrieve data for ticker '{ticker}'.", status_code=404)


class YFinanceError(AppError):
    def __init__(self, ticker: str, detail: str = ""):
        msg = f"Data retrieval failed for '{ticker}'."
        if detail:
            msg = f"{msg} {detail}"
        super().__init__(msg, status_code=502)


class YFinanceTimeoutError(AppError):
    def __init__(self, ticker: str, timeout: float):
        super().__init__(
            f"Data retrieval for '{ticker}' timed out after {timeout:.0f}s.",
            status_code=504,
        )


class AIProviderError(AppError):
    def __init__(self, detail: str = ""):
        msg = "AI analysis unavailable."
        if detail:
            msg = f"{msg} {detail}"
        super().__init__(msg, status_code=502)


class AITimeoutError(AppError):
    def __init__(self, timeout: float):
        super().__init__(
            f"AI analysis timed out after {timeout:.0f}s.", status_code=504
        )


class AIOutputError(AppError):
    def __init__(self, detail: str = ""):
        msg = "AI produced an invalid analysis output."
        if detail:
            msg = f"{msg} {detail}"
        super().__init__(msg, status_code=502)
