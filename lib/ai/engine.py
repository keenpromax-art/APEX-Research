from __future__ import annotations

import json
from typing import Any

from lib.ai.provider import AIProvider
from lib.ai.validator import OutputValidator, ValidationFailure, parse_document
from lib.exceptions import AIOutputError
from lib.rendering.blocks import AnalysisDocument

_SYSTEM_PROMPT = """You are the equity research intelligence engine.

You receive a normalized financial dataset retrieved from Yahoo Finance (yfinance) for one or more companies, plus the user's request. The dataset includes raw financials, market data, deterministic derived metrics (each with its formula), named chart series, and a data-quality report.

HARD RULES
1. The provided dataset is the ONLY source of facts. Never use outside knowledge: no news, no market share figures, no competitor facts, no management quotes, no macroeconomic claims, no analyst opinions unless they appear in the dataset.
2. Never invent a number. Every number you write must appear in the dataset or be a deterministic derived metric from it. Use metric blocks with metricKey to attach verified numbers. If a needed value is absent, say the data is unavailable.
3. Distinguish in every claim: FACT (directly in the data), CALCULATION (computed by code; the formula is given in derivedMetrics), INTERPRETATION (your judgment about what the numbers mean), UNCERTAINTY (the data cannot answer this).
4. Do not summarize everything. Prioritize what is material: major changes, trend breaks, unusual movements, profitability shifts, cash-flow quality, balance-sheet changes, valuation, anomalies, risks, and what cannot be concluded.
5. If data is incomplete, say so explicitly and state what is missing.
6. With multiple companies, compare them on the metrics provided and highlight the most decision-relevant differences.
7. Organize your response freely. Choose the blocks, their order, and their depth. There is no fixed report format.

OUTPUT CONTRACT
Respond with ONLY a json object (no markdown, no commentary):
{
  "title": string,
  "summary": string (2-4 sentences capturing the most decision-relevant findings),
  "blocks": [ ... ]
}

Block types (discriminate on "type"):
- {"type":"heading","level":2|3|4,"content":string}
- {"type":"paragraph","content":string,"epistemic":"fact"|"calculation"|"interpretation"|"uncertainty"|null}
- {"type":"metric","label":string,"value":number,"unit":string,"metricKey":string (MUST exist in derivedMetrics),"change":number|null}
- {"type":"table","columns":[string],"rows":[[string|number|null]]} (every number must exist in the dataset)
- {"type":"chart","title":string,"chartType":"line"|"bar","ref":string (MUST exist in series) OR "data":[{"label":string,"value":number}]}
- {"type":"callout","variant":"info"|"warning"|"uncertainty"|"fact","content":string}
- {"type":"list","ordered":boolean,"items":[string]}
- {"type":"formula","expression":string,"result":number|null}
- {"type":"provenance","items":[{"claim":string,"value":number|null,"source":string}]}

Numeric integrity is machine-checked. Any number not traceable to the dataset causes rejection, so write only numbers you can see in the data. Years, counts of periods, and quarter labels are fine.
"""


class AIEngine:
    """One strong analysis call. No sub-agents, no multi-stage pipelines."""

    def __init__(
        self,
        provider: AIProvider,
        timeout: float = 120.0,
        max_output_retries: int = 1,
    ):
        self._provider = provider
        self._timeout = timeout
        self._max_output_retries = max_output_retries

    def analyze(self, context: dict[str, Any]) -> AnalysisDocument:
        validator = OutputValidator(context)
        messages: list[dict[str, str]] = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": self._build_user_message(context)},
        ]

        last_problems: list[str] = []
        for attempt in range(self._max_output_retries + 1):
            raw = self._provider.generate(messages, timeout=self._timeout)
            try:
                document = parse_document(raw)
                validator.validate(document)
                return document
            except ValidationFailure as failure:
                last_problems = failure.problems
                messages.append({"role": "assistant", "content": raw})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Your previous output was rejected. Fix these problems and respond with ONLY the corrected JSON object:\n"
                            + "\n".join(f"- {p}" for p in last_problems[:10])
                        ),
                    }
                )

        raise AIOutputError(
            "AI output failed validation after retries: " + "; ".join(last_problems[:10])
        )

    def _build_user_message(self, context: dict[str, Any]) -> str:
        request = context.get("userRequest", "")
        payload = {
            "userRequest": request,
            "companies": context["companies"],
            "meta": context["meta"],
        }
        return (
            f"User request: {request}\n\n"
            f"Dataset (the only source of facts):\n```json\n{json.dumps(payload, default=str)}\n```"
        )
