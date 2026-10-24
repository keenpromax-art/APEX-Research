from __future__ import annotations


class ApexError(Exception):
    pass


class DataError(ApexError):
    pass


class TickerNotFoundError(DataError):
    def __init__(self, ticker: str):
        super().__init__(f"Ticker not found or no data available: {ticker}")
        self.ticker = ticker


class YFinanceError(DataError):
    def __init__(self, ticker: str, detail: str):
        super().__init__(f"yfinance error for {ticker}: {detail}")
        self.ticker = ticker
        self.detail = detail


class YFinanceTimeoutError(DataError):
    def __init__(self, ticker: str, timeout: float):
        super().__init__(f"yfinance timed out after {timeout}s for {ticker}")
        self.ticker = ticker
        self.timeout = timeout


class AIError(ApexError):
    pass


class AIProviderError(AIError):
    def __init__(self, provider: str, detail: str):
        super().__init__(f"{provider}: {detail}")
        self.provider = provider
        self.detail = detail


class AITimeoutError(AIError):
    def __init__(self, provider: str, timeout: float):
        super().__init__(f"{provider} timed out after {timeout}s")
        self.provider = provider
        self.timeout = timeout


class ModelNotFoundError(ApexError):
    pass


class ValidationError(ApexError):
    pass
