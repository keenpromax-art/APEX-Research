from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, ValidationError

from lib.rendering.blocks import (
    AnalysisDocument,
    Block,
    CalloutBlock,
    ChartBlock,
    FormulaBlock,
    HeadingBlock,
    ListBlock,
    MetricBlock,
    ParagraphBlock,
    ProvenanceBlock,
    TableBlock,
)

_NUMBER_RE = re.compile(r"(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?\s?[%x]?(?![A-Za-z0-9])")
_SUFFIX_SCALE_RE = re.compile(r"^(-?[\d,]+(?:\.\d+)?)\s?([KkMmBbTt])?$")
_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b")
_QUARTER_RE = re.compile(r"\b(?:Q[1-4]|FY\d{4}|H[12])(?:\s?FY?\d{4})?\b")
_ALLOWED_SMALL_INTEGERS = set(range(1, 13))
_YEAR_RANGE = range(1990, 2031)
_REL_TOLERANCE = 0.02
_ABS_TOLERANCE = 0.005


class ValidationFailure(Exception):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems[:10]))


def parse_document(raw: str) -> AnalysisDocument:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValidationFailure([f"AI output is not valid JSON: {exc}"])
    try:
        return AnalysisDocument.model_validate(data)
    except ValidationError as exc:
        problems = [f"{' -> '.join(str(p) for p in err.get('loc', []))}: {err.get('msg', 'invalid')}" for err in exc.errors()[:10]]
        raise ValidationFailure([f"AI output does not match the block schema: {problems}"])


class OutputValidator:
    """Deterministic guarantee: no number the AI writes can exist outside the dataset."""

    def __init__(self, context: dict[str, Any]):
        self._known: set[float] = set()
        self._metric_index: dict[str, float] = {}
        self._series_index: set[str] = set()
        self._collect(context)

    def validate(self, document: AnalysisDocument) -> None:
        problems: list[str] = []
        for i, block in enumerate(document.blocks):
            problems.extend(self._validate_block(block, i))
        if problems:
            raise ValidationFailure(problems)

    def _validate_block(self, block: Block, index: int) -> list[str]:
        where = f"block[{index}]({block.type})"
        if isinstance(block, HeadingBlock):
            return self._check_text(block.content, where)
        if isinstance(block, ParagraphBlock):
            return self._check_text(block.content, where)
        if isinstance(block, CalloutBlock):
            return self._check_text(block.content, where)
        if isinstance(block, ListBlock):
            problems: list[str] = []
            for item in block.items:
                problems.extend(self._check_text(item, where))
            return problems
        if isinstance(block, MetricBlock):
            return self._validate_metric(block, where)
        if isinstance(block, TableBlock):
            return self._validate_table(block, where)
        if isinstance(block, ChartBlock):
            return self._validate_chart(block, where)
        if isinstance(block, FormulaBlock):
            problems = []
            if block.result is not None:
                problems.extend(self._check_number(block.result, where))
            return problems
        if isinstance(block, ProvenanceBlock):
            problems = []
            for item in block.items:
                problems.extend(self._check_text(item.claim, where))
                if item.value is not None:
                    problems.extend(self._check_number(item.value, where))
            return problems
        return []

    def _validate_metric(self, block: Any, where: str) -> list[str]:
        problems: list[str] = []
        metric = self._metric_index.get(block.metricKey)
        if metric is None:
            problems.append(f"{where}: unknown metricKey '{block.metricKey}'")
        elif abs(block.value - metric) > max(0.001 * abs(metric), 1e-9):
            problems.append(f"{where}: value {block.value} does not match metric '{block.metricKey}' ({metric})")
        if block.change is not None:
            problems.extend(self._check_number(block.change, where))
        return problems

    def _validate_table(self, block: Any, where: str) -> list[str]:
        problems: list[str] = []
        for r, row in enumerate(block.rows):
            for c, cell in enumerate(row):
                if isinstance(cell, (int, float)) and not isinstance(cell, bool):
                    problems.extend(self._check_number(cell, f"{where} row[{r}] col[{c}]"))
        return problems

    def _validate_chart(self, block: Any, where: str) -> list[str]:
        problems: list[str] = []
        if block.ref is not None:
            if block.ref not in self._series_index:
                problems.append(f"{where}: unknown series ref '{block.ref}'")
        if block.data:
            for point in block.data:
                problems.extend(self._check_number(point.value, where))
        if block.ref is None and not block.data:
            problems.append(f"{where}: chart needs either a ref or inline data")
        return problems

    def _check_text(self, text: str, where: str) -> list[str]:
        cleaned = _DATE_RE.sub(" ", text)
        cleaned = _QUARTER_RE.sub(" ", cleaned)
        problems: list[str] = []
        for match in _NUMBER_RE.finditer(cleaned):
            problems.extend(self._check_number_token(match.group(0), text, where))
        return problems

    def _check_number_token(self, token: str, original_text: str, where: str) -> list[str]:
        parsed = _parse_number(token)
        if parsed is None:
            return []
        return self._check_number(parsed, where, original_text)

    def _check_number(self, value: float, where: str, original_text: str | None = None) -> list[str]:
        if self._is_allowed_unchecked(value):
            return []
        if self._matches_known(value, original_text):
            return []
        return [f"{where}: number {value} is not traceable to the provided dataset"]

    def _is_allowed_unchecked(self, value: float) -> bool:
        if value == 0:
            return True
        if value == int(value) and int(value) in _ALLOWED_SMALL_INTEGERS:
            return True
        if value == int(value) and int(value) in _YEAR_RANGE:
            return True
        return False

    def _matches_known(self, value: float, original_text: str | None) -> bool:
        for known in self._known:
            if abs(value - known) <= max(_REL_TOLERANCE * abs(known), _ABS_TOLERANCE):
                return True
        return False

    def _collect(self, context: dict[str, Any]) -> None:
        for company in context.get("companies", []):
            self._collect_numbers(company.get("market"))
            self._collect_numbers(company.get("price"))
            self._collect_numbers(company.get("valuation"))
            self._collect_numbers(company.get("analystData"))
            financials = company.get("financials", {})
            for statement in [
                financials.get("income_statement"),
                financials.get("balance_sheet"),
                financials.get("cash_flow"),
            ]:
                self._collect_statement(statement)
            for statement in financials.get("quarterly", {}).values():
                self._collect_statement(statement)
            for dividend in company.get("dividends") or []:
                self._add_number(dividend.get("amount"))
            earnings = company.get("earnings") or {}
            for row in earnings.get("recent", []):
                self._collect_numbers(row)
            for key, metric in (company.get("derivedMetrics") or {}).items():
                value = metric.get("value")
                if isinstance(value, (int, float)):
                    self._add_number(value)
                    self._metric_index[key] = float(value)
                for period_value in (metric.get("byPeriod") or {}).values():
                    if isinstance(period_value, (int, float)):
                        self._add_number(period_value)
            for series_name, points in (company.get("series") or {}).items():
                self._series_index.add(series_name)
                for point in points:
                    self._add_number(point.get("value"))

    def _collect_statement(self, statement: dict[str, Any] | None) -> None:
        if not statement:
            return
        for line_item_values in (statement.get("lineItems") or {}).values():
            for value in line_item_values.values():
                if isinstance(value, (int, float)):
                    self._add_number(value)

    def _collect_numbers(self, obj: Any) -> None:
        if isinstance(obj, dict):
            for value in obj.values():
                self._collect_numbers(value)
        elif isinstance(obj, list):
            for value in obj:
                self._collect_numbers(value)
        elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
            self._add_number(obj)

    def _add_number(self, value: float) -> None:
        self._known.add(float(value))
        self._known.add(float(value) * 100.0)
        self._known.add(float(value) / 1_000_000.0)
        self._known.add(float(value) / 1_000_000_000.0)


def _parse_number(token: str) -> float | None:
    cleaned = token.replace(",", "").replace("$", "").strip()
    is_percent = cleaned.endswith("%")
    if is_percent:
        cleaned = cleaned[:-1]
    cleaned = re.sub(r"[xX]$", "", cleaned).strip()
    match = _SUFFIX_SCALE_RE.match(cleaned)
    if not match:
        return None
    try:
        value = float(match.group(1))
    except ValueError:
        return None
    suffix = (match.group(2) or "").lower()
    scale = {"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12}.get(suffix, 1.0)
    value *= scale
    if is_percent:
        value /= 100.0
    return value
