"""Post-render QA for the generated research PDF.

Extracts text from the rendered PDF and reconciles it against the payload so a
broken render (blank page, missing section, wrong target price, missing
disclosures) is caught before the report is stored, rather than discovered by a
reader.
"""

from __future__ import annotations

import io
import re
from typing import Any

from pypdf import PdfReader

from .pdf_report import _price

SECTION_MARKERS = (
    "Investment thesis",
    "Company and business overview",
    "Financial performance",
    "Operating drivers",
    "Valuation",
    "Forecast drivers",
    "Risks and monitoring",
    "Sources, provenance",
    "Disclosures",
)


def _issue(level: str, check: str, detail: str) -> dict[str, str]:
    return {"level": level, "check": f"pdf.{check}", "detail": detail}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _money_in_text(value: float, text: str) -> bool:
    if value is None:
        return True
    for precision in (2, 1, 0):
        rendered = f"{value:,.{precision}f}"
        if rendered in text or rendered.rstrip("0").rstrip(".") in text:
            return True
    compact = f"{value / 1e9:.1f}B"
    if compact in text:
        return True
    compact = f"{value / 1e6:.1f}M"
    return compact in text


def _ink_coverage(pdf_bytes: bytes) -> float | None:
    try:
        import pymupdf  # type: ignore
    except Exception:
        return None
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None
    try:
        if doc.page_count == 0:
            return 0.0
        total = 0.0
        for page in doc:
            pix = page.get_pixmap(dpi=50, colorspace=pymupdf.csGRAY)
            samples = pix.samples
            if not samples:
                continue
            dark = sum(1 for b in samples if b < 250)
            total += dark / len(samples)
        return total / doc.page_count
    except Exception:
        return None
    finally:
        doc.close()


def run_pdf_qa(pdf_bytes: bytes, payload: dict[str, Any], config: dict[str, Any] | None = None) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    config = config or {}

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as error:
        return [_issue("error", "unreadable", f"PDF could not be parsed: {error}")]

    page_texts: list[str] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            raw = page.extract_text() or ""
        except Exception:
            raw = ""
        page_texts.append(_norm(raw))

    if not page_texts:
        issues.append(_issue("error", "empty", "PDF contains no pages."))
        return issues

    full_text = " ".join(page_texts)

    blank = [i for i, text in enumerate(page_texts, start=1) if len(text) < 80]
    if blank:
        issues.append(_issue("error", "blank_pages", f"Pages with almost no extractable text: {blank}."))

    if len(page_texts) < 3:
        issues.append(_issue("error", "too_short", f"Report has only {len(page_texts)} page(s); expected at least 3."))

    missing_sections = [name for name in SECTION_MARKERS if name not in full_text]
    if missing_sections:
        issues.append(_issue("error", "missing_sections", f"Required sections not found: {missing_sections}."))

    ticker = str(payload.get("ticker") or config.get("ticker") or "").upper()
    if ticker and ticker not in full_text.upper():
        issues.append(_issue("error", "ticker_missing", f"Ticker {ticker} does not appear in the rendered text."))

    rating = payload.get("rating") or {}
    price = payload.get("price") or {}
    target = rating.get("target_price")
    if target is not None:
        if not _money_in_text(float(target), full_text):
            issues.append(_issue("error", "target_price_mismatch",
                                 f"Target price {target} from the payload is not present in the rendered PDF."))
    current = price.get("current")
    if current is not None and not _money_in_text(float(current), full_text):
        issues.append(_issue("warning", "price_mismatch",
                             f"Current price {current} from the payload is not present in the rendered PDF."))

    forecast_labels = ((payload.get("forecast") or {}).get("labels")) or []
    if forecast_labels:
        last_label = str(forecast_labels[-1])
        if last_label not in full_text:
            issues.append(_issue("warning", "forecast_labels_missing",
                                 f"Forecast column label '{last_label}' not found in the rendered PDF."))

    if "Page" not in full_text:
        issues.append(_issue("warning", "page_numbering", "No page numbering text found in the rendered PDF."))

    if "Disclosures" not in full_text:
        issues.append(_issue("error", "disclosures_missing", "The disclosures section is missing from the rendered PDF."))

    sources = payload.get("sources") or []
    if sources:
        first = str((sources[0] or {}).get("ref") or (sources[0] or {}).get("label") or "")
        if first and first not in full_text:
            issues.append(_issue("warning", "sources_missing",
                                 f"First source reference '{first}' not found in the rendered PDF."))

    if len(pdf_bytes) < 20_000:
        issues.append(_issue("warning", "small_file", f"PDF is only {len(pdf_bytes):,} bytes; render may be incomplete."))

    coverage = _ink_coverage(pdf_bytes)
    if coverage is not None:
        if coverage < 0.005:
            issues.append(_issue("error", "blank_render", f"Page ink coverage is {coverage:.3%}; pages appear visually blank."))
        elif coverage < 0.02:
            issues.append(_issue("warning", "low_ink", f"Page ink coverage is low ({coverage:.3%})."))

    if not issues:
        issues.append(_issue("info", "passed",
                             f"Rendered PDF checks passed: {len(page_texts)} pages, target price and required sections present."))
    return issues
