from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, Field


class HeadingBlock(BaseModel):
    type: Literal["heading"] = "heading"
    level: int = Field(default=2, ge=2, le=4)
    content: str


class ParagraphBlock(BaseModel):
    type: Literal["paragraph"] = "paragraph"
    content: str
    epistemic: Literal["fact", "calculation", "interpretation", "uncertainty"] | None = None


class MetricBlock(BaseModel):
    type: Literal["metric"] = "metric"
    label: str
    value: float
    unit: str = "number"
    metricKey: str
    change: float | None = None


class TableBlock(BaseModel):
    type: Literal["table"] = "table"
    columns: list[str]
    rows: list[list[Union[str, float, int, None]]]


class ChartPoint(BaseModel):
    label: str
    value: float


class ChartBlock(BaseModel):
    type: Literal["chart"] = "chart"
    title: str
    chartType: Literal["line", "bar"] = "line"
    ref: str | None = None
    data: list[ChartPoint] | None = None


class CalloutBlock(BaseModel):
    type: Literal["callout"] = "callout"
    variant: Literal["info", "warning", "uncertainty", "fact"] = "info"
    content: str


class ListBlock(BaseModel):
    type: Literal["list"] = "list"
    items: list[str]
    ordered: bool = False


class FormulaBlock(BaseModel):
    type: Literal["formula"] = "formula"
    expression: str
    result: float | None = None


class ProvenanceItem(BaseModel):
    claim: str
    value: float | None
    source: str


class ProvenanceBlock(BaseModel):
    type: Literal["provenance"] = "provenance"
    items: list[ProvenanceItem]


Block = Union[
    HeadingBlock,
    ParagraphBlock,
    MetricBlock,
    TableBlock,
    ChartBlock,
    CalloutBlock,
    ListBlock,
    FormulaBlock,
    ProvenanceBlock,
]


class AnalysisDocument(BaseModel):
    title: str
    summary: str
    blocks: list[Block] = Field(..., min_length=1, max_length=200)
