"""Post-render QA for the generated research PDF.

Extracts text from the rendered PDF and reconciles it against the payload so a
broken render (blank page, missing section, wrong target price, missing
disclosures) is caught before the report is stored, rather than discovered by a
reader. Two layers:

1. Financial reconciliation (blocking): rating code, implied upside, DCF fair
   value, WACC, first forecast revenue and currency must appear in the rendered
   text, each built with the same formatters the PDF uses.
2. Visual/geometry checks (pymupdf, when available): text outside the page
   bounds, overlapping text blocks, sub-5.5pt type, near-blank pages and
   garbled (replacement/private-use) glyphs.
"""

from __future__ import annotations

import io
import re
from typing import Any

from pypdf import PdfReader

from .pdf_report import _money, _pct, _price, _signed_pct

SECTION_MARKERS = (
    "Investment thesis",
    "Financial performance",
    "Valuation",
    "Forecast drivers",
    "Investment conclusion",
    "Risks and monitoring",
    "Sources, provenance",
    "Data gaps",
    "Disclosures",
)

# Present only in full-length reports (quick omits them by design).
FULL_SECTION_MARKERS = (
    "Executive summary",
    "Contents",
    "Company and business overview",
    "Operating drivers",
)

MIN_TINY_TEXT_PT = 5.5
MIN_PAGE_INK_ERROR = 0.002
MIN_PAGE_INK_WARN = 0.008
OVERLAP_FRACTION = 0.35


def _issue(level: str, check: str, detail: str) -> dict[str, str]:
    return {"level": level, "check": f"pdf.{check}", "detail": detail}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _match_text(text: str) -> str:
    """Fold unicode minus/dashes to ASCII so formatter output matches extraction."""
    return (
        text.replace("\u2212", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )


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


def _financial_checks(payload: dict[str, Any], full_text: str, issues: list[dict[str, str]]) -> None:
    norm_text = _match_text(full_text)
    upper = norm_text.upper()
    currency = str((payload.get("meta") or {}).get("currency") or "USD")
    rating = payload.get("rating") or {}
    price = payload.get("price") or {}
    valuation = payload.get("valuation") or {}
    dcf = valuation.get("dcf") or {}
    forecast = payload.get("forecast") or {}
    periods = forecast.get("periods") or []

    code = str(rating.get("code") or "")
    if code in ("BUY", "HOLD", "SELL") and code not in upper:
        issues.append(_issue("error", "rating_code_missing",
                             f"Rating code {code} does not appear in the rendered PDF."))

    target = rating.get("target_price")
    if target is not None:
        expected = _match_text(_price(target, currency))
        if expected not in norm_text and not _money_in_text(float(target), norm_text):
            issues.append(_issue("error", "target_price_mismatch",
                                 f"Target price {expected} from the payload is not present in the rendered PDF."))

    current = price.get("current")
    if current is not None and not _money_in_text(float(current), norm_text):
        issues.append(_issue("warning", "price_mismatch",
                             f"Current price {current} from the payload is not present in the rendered PDF."))

    upside = rating.get("upside")
    if upside is not None:
        signed = _match_text(_signed_pct(upside))
        plain = _match_text(_pct(abs(float(upside))))
        if signed not in norm_text and plain not in norm_text:
            issues.append(_issue("error", "upside_missing",
                                 f"Implied upside {signed} from the payload is not present in the rendered PDF."))

    fair_value = dcf.get("value_per_share")
    if fair_value is not None:
        expected = _match_text(_price(fair_value, currency))
        if expected not in norm_text and not _money_in_text(float(fair_value), norm_text):
            issues.append(_issue("error", "fair_value_mismatch",
                                 f"DCF fair value {expected} from the payload is not present in the rendered PDF."))

    wacc = valuation.get("wacc")
    if wacc is not None:
        expected = _pct(wacc)
        if expected not in norm_text:
            issues.append(_issue("error", "wacc_missing",
                                 f"WACC {expected} from the payload is not present in the rendered PDF."))

    if periods:
        revenue = (periods[0] or {}).get("revenue")
        if revenue is not None:
            expected = _match_text(_money(revenue, currency))
            if expected not in norm_text and not _money_in_text(float(revenue), norm_text):
                issues.append(_issue("error", "forecast_revenue_missing",
                                     f"First forecast revenue {expected} from the payload is not present in the rendered PDF."))

    if currency and currency.upper() not in upper:
        issues.append(_issue("warning", "currency_missing",
                             f"Currency label {currency} does not appear in the rendered PDF."))

    scenarios = payload.get("scenarios") or {}
    for name in ("bear", "base", "bull"):
        scenario = scenarios.get(name) or {}
        scenario_price = scenario.get("target_price")
        if scenario_price is None:
            continue
        expected = _match_text(_price(scenario_price, currency))
        if expected not in norm_text:
            issues.append(_issue("warning", f"scenario_{name}_missing",
                                 f"{name.capitalize()} scenario price {expected} is not present in the rendered PDF."))


def _visual_checks(pdf_bytes: bytes, issues: list[dict[str, str]]) -> None:
    try:
        import pymupdf  # type: ignore
    except Exception:
        return
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return
    try:
        if doc.page_count == 0:
            return
        total_dark = 0
        total_px = 0
        for pno, page in enumerate(doc, start=1):
            pix = page.get_pixmap(dpi=50, colorspace=pymupdf.csGRAY)
            samples = pix.samples
            if samples:
                dark = sum(1 for b in samples if b < 250)
                total_dark += dark
                total_px += len(samples)
                ratio = dark / len(samples)
                if ratio < MIN_PAGE_INK_ERROR:
                    issues.append(_issue("error", "blank_render",
                                         f"Page {pno} ink coverage is {ratio:.3%}; the page appears visually blank."))
                elif ratio < MIN_PAGE_INK_WARN:
                    issues.append(_issue("warning", "sparse_page",
                                         f"Page {pno} ink coverage is low ({ratio:.3%})."))

            rect = page.rect
            line_boxes: list[tuple[float, float, float, float]] = []
            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    bbox = tuple(line.get("bbox") or ())
                    if len(bbox) != 4:
                        continue
                    line_boxes.append(bbox)
                    x0, y0, x1, y1 = bbox
                    if x0 < -2 or y0 < -2 or x1 > rect.width + 2 or y1 > rect.height + 2:
                        issues.append(_issue("error", "text_out_of_bounds",
                                             f"Page {pno}: text line at ({x0:.0f},{y0:.0f},{x1:.0f},{y1:.0f}) "
                                             f"extends outside the page ({rect.width:.0f}x{rect.height:.0f})."))
                    for span in line.get("spans", []):
                        size = float(span.get("size") or 0)
                        if 0 < size < MIN_TINY_TEXT_PT:
                            issues.append(_issue("warning", "tiny_text",
                                                 f"Page {pno}: text rendered at {size:.1f}pt is below "
                                                 f"the {MIN_TINY_TEXT_PT}pt minimum."))
                        text = span.get("text") or ""
                        if "\ufffd" in text or any("\ue000" <= ch <= "\uf8ff" for ch in text):
                            issues.append(_issue("error", "garbled_text",
                                                 f"Page {pno}: replacement or private-use characters "
                                                 "found in rendered text."))
            overlaps = 0
            for i in range(len(line_boxes)):
                for j in range(i + 1, len(line_boxes)):
                    a = line_boxes[i]
                    b = line_boxes[j]
                    ix0 = max(a[0], b[0])
                    iy0 = max(a[1], b[1])
                    ix1 = min(a[2], b[2])
                    iy1 = min(a[3], b[3])
                    if ix1 <= ix0 or iy1 <= iy0:
                        continue
                    dx = ix1 - ix0
                    dy = iy1 - iy0
                    if dx < 1.5 or dy < 1.5:
                        continue
                    area_a = max(1e-6, (a[2] - a[0]) * (a[3] - a[1]))
                    area_b = max(1e-6, (b[2] - b[0]) * (b[3] - b[1]))
                    if (dx * dy) / min(area_a, area_b) > OVERLAP_FRACTION:
                        overlaps += 1
                        if overlaps <= 3:
                            issues.append(_issue("warning", "text_overlap",
                                                 f"Page {pno}: text lines overlap by more than "
                                                 f"{OVERLAP_FRACTION:.0%} of the smaller line."))
            if overlaps > 3:
                issues.append(_issue("warning", "text_overlap",
                                     f"Page {pno}: {overlaps} overlapping text line pairs detected."))

        if total_px and total_dark / total_px < MIN_PAGE_INK_ERROR:
            issues.append(_issue("error", "blank_render",
                                 f"Overall ink coverage is {total_dark / total_px:.3%}; "
                                 "the render appears visually blank."))
    except Exception:
        return
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

    required = list(SECTION_MARKERS)
    report_type = str(config.get("report_type") or "").lower()
    if report_type == "full":
        is_full = True
    elif report_type == "quick":
        is_full = False
    else:
        # Config silent: a TOC or executive summary only exists in full reports.
        is_full = "Contents" in full_text or "Executive summary" in full_text
    if is_full:
        required += list(FULL_SECTION_MARKERS)
    missing_sections = [name for name in required if name not in full_text]
    if missing_sections:
        issues.append(_issue("error", "missing_sections", f"Required sections not found: {missing_sections}."))

    ticker = str(payload.get("ticker") or config.get("ticker") or "").upper()
    if ticker and ticker not in full_text.upper():
        issues.append(_issue("error", "ticker_missing", f"Ticker {ticker} does not appear in the rendered text."))

    _financial_checks(payload, full_text, issues)

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

    _visual_checks(pdf_bytes, issues)

    if not issues:
        issues.append(_issue("info", "passed",
                             f"Rendered PDF checks passed: {len(page_texts)} pages, financial reconciliation "
                             "and geometry checks clean."))
    return issues
