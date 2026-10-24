from __future__ import annotations

"""Institutional research PDF builder.

Produces a broker-style, multi-page, print-oriented research document from the
deterministic report payload (report_engine.py). Layout rules:

- Cover page: identity, rating banner with price timestamp, market data,
  price chart, executive summary, central arguments, risks + catalysts and a
  historical-vs-forecast highlights table. The cover is a single dedicated
  page and is excluded from body page numbering.
- Body flows naturally (CondPageBreak + repeatRows); sections are never forced
  onto a fresh page, so the report carries no blank or near-blank pages.
- Every table carries a source line. Forecast columns/rows are italic on a
  blue tint. Missing data is an em-dash, never zero.
"""

import io
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader  # noqa: F401
from reportlab.pdfgen import canvas as _canvas_module
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    CHARTS_OK = True
except Exception:  # pragma: no cover - charts degrade gracefully
    CHARTS_OK = False

PAGE_W, PAGE_H = A4
MARGIN = 13 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
FRAME_BOTTOM = 15.5 * mm
FRAME_TOP = 18 * mm

INK = colors.HexColor("#0A2540")
SLATE = colors.HexColor("#1E293B")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#C7D0DC")
FILL = colors.HexColor("#F1F5F9")
FILL_DEEP = colors.HexColor("#E2E8F0")
ACCENT = colors.HexColor("#1D4ED8")
FORECAST_TINT = colors.HexColor("#EAF1FD")
POS = colors.HexColor("#15803D")
NEG = colors.HexColor("#B91C1C")
WARN = colors.HexColor("#B45309")

RATING_BG = {
    "BUY": colors.HexColor("#0B7A3E"),
    "HOLD": colors.HexColor("#B45309"),
    "SELL": colors.HexColor("#B91C1C"),
    "NOT RATED": colors.HexColor("#475569"),
}

CURRENCY_SYMBOLS = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "¥", "HKD": "HK$", "SGD": "S$", "AED": "AED "}


# --------------------------------------------------------------------------- #
# formatting
# --------------------------------------------------------------------------- #

def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _compact(value: Any, digits: float = 1) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    abs_value = abs(number)
    if abs_value >= 1e12:
        return f"{number / 1e12:,.1f}T"
    if abs_value >= 1e9:
        return f"{number / 1e9:,.1f}B"
    if abs_value >= 1e6:
        return f"{number / 1e6:,.1f}M"
    if abs_value >= 1e3:
        return f"{number / 1e3:,.1f}k"
    if abs_value == 0:
        return "0"
    return f"{number:,.{digits}f}"


def _currency_symbol(currency: str | None) -> str:
    return CURRENCY_SYMBOLS.get(str(currency or "").upper(), "")


def _money(value: Any, currency: str | None = None) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    sign = "−" if number < 0 else ""
    return f"{sign}{_currency_symbol(currency)}{_compact(abs(number))}"


def _price(value: Any, currency: str | None = None) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    return f"{_currency_symbol(currency)}{number:,.2f}"


def _num(value: Any, digits: int = 2) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    return f"{number:,.{digits}f}"


def _pct(value: Any, digits: int = 1) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    return f"{number * 100:,.{digits}f}%"


def _signed_pct(value: Any, digits: int = 1) -> str:
    number = _finite(value)
    if number is None:
        return "—"
    return f"{number * 100:+,.{digits}f}%"


def fy_label(base_fy: int | None, year_index: int) -> str:
    if base_fy is None:
        return f"Y{year_index}E"
    return f"FY{base_fy + year_index}E"


def _base_fy(payload: dict[str, Any]) -> int | None:
    base_period = payload.get("forecast", {}).get("base_period") or ""
    try:
        return int(str(base_period)[:4])
    except (TypeError, ValueError):
        return None


def _forecast_labels(payload: dict[str, Any]) -> list[str]:
    labels = payload.get("forecast", {}).get("labels") or []
    if labels:
        return labels
    base_fy = _base_fy(payload)
    years = int(payload.get("forecast", {}).get("years") or 5)
    return [fy_label(base_fy, index + 1) for index in range(years)]


def _escape(text: Any) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# --------------------------------------------------------------------------- #
# styles
# --------------------------------------------------------------------------- #

def _styles() -> dict[str, ParagraphStyle]:
    base = dict(fontName="Helvetica", fontSize=9.0, leading=12.0, textColor=SLATE)
    return {
        "body": ParagraphStyle("body", **base),
        "body_sm": ParagraphStyle(
            "body_sm", **{key: value for key, value in base.items() if key not in ("fontSize", "leading")},
            fontSize=8.4, leading=11.2,
        ),
        "body_muted": ParagraphStyle(
            "body_muted",
            **{key: value for key, value in base.items() if key not in ("textColor", "fontSize", "leading")},
            textColor=MUTED,
            fontSize=8.0,
            leading=10.6,
        ),
        "section": ParagraphStyle(
            "section", fontName="Helvetica-Bold", fontSize=13, leading=15.5,
            textColor=INK, spaceBefore=0, spaceAfter=2,
        ),
        "subsection": ParagraphStyle(
            "subsection", fontName="Helvetica-Bold", fontSize=9.8, leading=12.4,
            textColor=INK, spaceBefore=6, spaceAfter=2,
        ),
        "eyebrow": ParagraphStyle(
            "eyebrow", fontName="Helvetica-Bold", fontSize=7.0, leading=9,
            textColor=ACCENT, spaceAfter=1,
        ),
        "cell": ParagraphStyle("cell", fontSize=7.7, leading=9.6, textColor=SLATE),
        "cell_muted": ParagraphStyle("cell_muted", fontSize=7.6, leading=9.6, textColor=MUTED),
        "cell_right": ParagraphStyle("cell_right", alignment=TA_RIGHT, fontSize=7.8, leading=9.8, textColor=SLATE),
        "cell_bold": ParagraphStyle("cell_bold", fontName="Helvetica-Bold", fontSize=7.8, leading=9.8, textColor=INK),
        "bullet": ParagraphStyle("bullet", fontSize=8.6, leading=11.4, textColor=SLATE, leftIndent=8, bulletIndent=2, spaceAfter=2.2),
        "bullet_sm": ParagraphStyle("bullet_sm", fontSize=8.1, leading=10.8, textColor=SLATE, leftIndent=7, bulletIndent=1, spaceAfter=1.8),
        "note": ParagraphStyle("note", fontSize=7.4, leading=9.6, textColor=MUTED, spaceBefore=1.5),
        "disclaimer": ParagraphStyle("disclaimer", fontSize=7.6, leading=10.4, textColor=MUTED, alignment=TA_LEFT),
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17.5, leading=21, textColor=INK),
        "h1_sub": ParagraphStyle("h1_sub", fontSize=9.0, leading=11.8, textColor=MUTED),
        "title_line": ParagraphStyle("title_line", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=ACCENT),
        "th_left": ParagraphStyle("th_left", fontName="Helvetica-Bold", fontSize=7.7, leading=9.6, textColor=colors.white, alignment=TA_LEFT),
        "th_right": ParagraphStyle("th_right", fontName="Helvetica-Bold", fontSize=7.7, leading=9.6, textColor=colors.white, alignment=TA_RIGHT),
        "toc_entry": ParagraphStyle("toc_entry", fontSize=9.0, leading=14, textColor=SLATE),
    }


S = _styles()

# exhibit and section counters (reset per document build)
_EXHIBIT = {"n": 0}
_SECTION = {"n": 0}


def _reset_counters() -> None:
    _EXHIBIT["n"] = 0
    _SECTION["n"] = 0


def _next_exhibit() -> int:
    _EXHIBIT["n"] += 1
    return _EXHIBIT["n"]


def exhibit_caption(text: str) -> Paragraph:
    """Numbered exhibit caption: 'Exhibit 3 — caption text'."""
    return Paragraph(_escape(f"Exhibit {_next_exhibit()} — {text}"), S["note"])


def _th(text: Any, align: str = "right") -> Paragraph:
    style = S["th_left"] if align == "left" else S["th_right"]
    return Paragraph(_escape(text), style)


def _cell(text: Any, align: str = "left", bold: bool = False, muted: bool = False, forecast: bool = False) -> Paragraph:
    if bold:
        style = S["cell_bold"]
    elif muted:
        style = S["cell_muted"]
    elif align == "right":
        style = S["cell_right"]
    else:
        style = S["cell"]
    if forecast:
        style = ParagraphStyle(f"f_{id(style)}", parent=style, fontName="Helvetica-Oblique")
    return Paragraph(_escape(text), style)


# --------------------------------------------------------------------------- #
# flowables
# --------------------------------------------------------------------------- #

class Rule(Flowable):
    def __init__(self, width: int, color=INK, thickness: float = 1.1, space_before: float = 0, space_after: float = 3):
        super().__init__()
        self.width = width
        self.color = color
        self.thickness = thickness
        self.space_before = space_before
        self.space_after = space_after

    def wrap(self, available_width, available_height):
        return (self.width, self.thickness + self.space_before + self.space_after)

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.space_after, self.width, self.space_after)


def section(title: str, subtitle: str | None = None, eyebrow: str | None = None, min_space: float = 175, number: bool = True) -> list:
    """Section heading that keeps its first block together (no forced break)."""
    if number:
        _SECTION["n"] += 1
        title = f"{_SECTION['n']}. {title}"
    out: list = [CondPageBreak(min_space), Rule(CONTENT_W, ACCENT, 2.2, space_before=4, space_after=1)]
    if eyebrow:
        out.append(Paragraph(_escape(eyebrow.upper()), S["eyebrow"]))
    out.append(Paragraph(_escape(title), S["section"]))
    if subtitle:
        out.append(Paragraph(_escape(subtitle), S["body_muted"]))
        out.append(Spacer(1, 2))
    return out


def _t(
    head: list[list[str]],
    body: list[list],
    widths: list[float],
    style_opts: list | None = None,
    forecast_from: int | None = None,
) -> Table:
    rows = [head] + body
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    opts: list = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("LEADING", (0, 0), (-1, -1), 9.6),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 1), (-1, -1), SLATE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, FILL]),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.35, LINE),
        ("LINEBELOW", (0, -1), (-1, -1), 0.8, SLATE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 1.7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.7),
    ]
    if forecast_from is not None:
        opts += [
            ("FONTNAME", (forecast_from, 1), (-1, -1), "Helvetica-Oblique"),
            ("BACKGROUND", (forecast_from, 1), (-1, -1), FORECAST_TINT),
        ]
    if style_opts:
        opts += style_opts
    table.setStyle(TableStyle(opts))
    return table


def source_line(text: str) -> Paragraph:
    return Paragraph(f"Source: {_escape(text)}", S["note"])


def _make_image(data: bytes, width: float) -> Image:
    reader = ImageReader(io.BytesIO(data)) if ImageReader is not None else None
    try:
        intrinsic_w, intrinsic_h = reader.getSize()
    except Exception:
        intrinsic_w, intrinsic_h = width, width / 2
    if not intrinsic_w or not intrinsic_h:
        intrinsic_w, intrinsic_h = width, width / 2
    height = width * intrinsic_h / intrinsic_w
    image = Image(io.BytesIO(data), width=width, height=height)
    image.hAlign = "LEFT"
    return image


def _captioned(image: Image, caption: str) -> list:
    return [image, exhibit_caption(caption)]


def _two_up(left: list, right: list) -> Table:
    grid = Table([[left, right]], colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5])
    grid.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 8), ("RIGHTPADDING", (1, 0), (1, 0), 0)]))
    return grid


# --------------------------------------------------------------------------- #
# charts (matplotlib → PNG)
# --------------------------------------------------------------------------- #

def _chart_style(ax, ygrid: bool = True):
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color("#94A3B8")
    ax.spines["bottom"].set_linewidth(0.6)
    ax.tick_params(colors="#64748B", labelsize=6.2, length=0)
    if ygrid:
        ax.grid(axis="y", color="#E2E8F0", linewidth=0.5)
    ax.set_axisbelow(True)


def _fig_bytes(fig) -> bytes:
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buffer.seek(0)
    return buffer.read()


def _pad_limits(lo: float, hi: float, pad: float = 0.10) -> tuple[float, float]:
    span = (hi - lo) or abs(hi) or 1.0
    return lo - span * pad, hi + span * pad


def chart_price(payload: dict[str, Any]) -> bytes | None:
    series = payload.get("price", {}).get("series") or []
    if not CHARTS_OK or len(series) < 12:
        return None
    dates = [str(row.get("date", "")) for row in series]
    closes = [row.get("close") or 0.0 for row in series]
    target = _finite((payload.get("rating") or {}).get("target_price"))
    lo, hi = min(closes), max(closes)
    if target is not None:
        lo, hi = min(lo, target), max(hi, target)
    lo, hi = _pad_limits(lo, hi, 0.14)
    lo = min(lo, min(closes) - 1e-9)

    def _tick_label(d: str) -> str:
        d = d[:10]
        try:
            dt = datetime.strptime(d, "%Y-%m-%d")
            return dt.strftime("%b %y")
        except ValueError:
            return d[2:7]

    fig, ax = plt.subplots(figsize=(3.3, 1.5))
    ax.fill_between(range(len(closes)), closes, lo, color="#93B4F5", alpha=0.30, linewidth=0)
    ax.plot(range(len(closes)), closes, color="#1D4ED8", linewidth=1.1)
    n_ticks = 4
    tick_idx = [round(i * (len(dates) - 1) / n_ticks) for i in range(n_ticks + 1)]
    tick_idx = sorted(set(tick_idx))
    ax.set_xticks(tick_idx)
    ax.set_xticklabels([_tick_label(dates[i]) for i in tick_idx], fontsize=6.0)
    ax.set_ylim(lo, hi)
    ax.set_ylabel(_currency(payload), fontsize=6, color="#64748B")
    if target is not None:
        ax.axhline(target, color="#B45309", linewidth=0.9, linestyle=(0, (4, 3)))
        ax.annotate(f"target {_price(target)}", (0.02, target), xycoords=("axes fraction", "data"), fontsize=5.8, color="#B45309", ha="left", va="bottom")
    ax.annotate(_price(closes[-1]), (len(closes) - 1, closes[-1]), xytext=(-2, 4), textcoords="offset points", fontsize=6.2, color="#1D4ED8", fontweight="bold", ha="right", va="bottom")
    _chart_style(ax)
    return _fig_bytes(fig)


def chart_hist_earnings(payload: dict[str, Any]) -> bytes | None:
    metrics = (payload.get("historical", {}).get("metrics") or [])[::-1]
    if not CHARTS_OK or len(metrics) < 2:
        return None
    labels = payload.get("historical", {}).get("periods", [])[::-1][: len(metrics)]
    revenue = [m.get("revenue") or 0 for m in metrics]
    ebitda = [m.get("ebitda") or 0 for m in metrics]
    net = [m.get("net_income") or 0 for m in metrics]
    x = range(len(metrics))
    width = 0.27
    fig, ax = plt.subplots(figsize=(3.35, 1.6))
    ax.bar([i - width for i in x], revenue, width, color="#1D4ED8", label="Revenue")
    ax.bar(list(x), ebitda, width, color="#64748B", label="EBITDA")
    ax.bar([i + width for i in x], net, width, color="#0EA5E9", label="Net income")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels or [str(i + 1) for i in x])
    lo, hi = min(min(revenue), 0), max(revenue)
    ax.set_ylim(*_pad_limits(lo, hi, 0.18))
    _chart_style(ax)
    ax.legend(fontsize=5.8, frameon=False, loc="upper left", ncol=3, handlelength=0.9, columnspacing=0.7)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: _compact(v)))
    ax.set_ylabel(_currency(payload), fontsize=6, color="#64748B")
    return _fig_bytes(fig)


def chart_margins(payload: dict[str, Any]) -> bytes | None:
    metrics = (payload.get("historical", {}).get("metrics") or [])[::-1]
    if not CHARTS_OK or len(metrics) < 2:
        return None
    labels = payload.get("historical", {}).get("periods", [])[::-1][: len(metrics)]
    fig, ax = plt.subplots(figsize=(3.35, 1.6))
    plotted = False
    all_values: list[float] = []
    for key, label, color, style in (
        ("gross_margin", "Gross", "#1D4ED8", "-"),
        ("ebitda_margin", "EBITDA", "#0EA5E9", "--"),
        ("net_margin", "Net", "#16A34A", (0, (4, 2))),
    ):
        values = [m.get(key) for m in metrics]
        if any(v is None for v in values):
            continue
        plotted = True
        all_values += [v * 100 for v in values]
        ax.plot(range(len(values)), [v * 100 for v in values], color=color, linewidth=1.1, linestyle=style, label=label)
    if not plotted:
        plt.close(fig)
        return None
    ax.set_xticks(list(range(len(metrics))))
    ax.set_xticklabels(labels)
    ax.set_ylabel("%", fontsize=6, color="#64748B")
    lo, hi = min(all_values), max(all_values)
    ax.set_ylim(*_pad_limits(lo, hi, 0.22))
    _chart_style(ax)
    ax.legend(fontsize=5.8, frameon=False, loc="upper left", ncol=3, handlelength=1.1, columnspacing=0.7)
    return _fig_bytes(fig)


def chart_quarterly(payload: dict[str, Any]) -> bytes | None:
    q_metrics = (payload.get("historical", {}).get("quarterly_metrics") or [])[::-1]
    q_labels = (payload.get("historical", {}).get("quarterly_periods") or [])[::-1]
    if not CHARTS_OK or len(q_metrics) < 2:
        return None
    labels = q_labels[: len(q_metrics)] or [str(i + 1) for i in range(len(q_metrics))]
    revenue = [_finite(m.get("revenue")) or 0.0 for m in q_metrics]
    ebitda = [_finite(m.get("ebitda")) or 0.0 for m in q_metrics]
    x = range(len(q_metrics))
    width = 0.38
    fig, ax = plt.subplots(figsize=(3.35, 1.5))
    ax.bar([i - width / 2 for i in x], revenue, width, color="#1D4ED8", label="Revenue")
    ax.bar([i + width / 2 for i in x], ebitda, width, color="#64748B", label="EBITDA")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=5.8)
    ax.set_ylim(0, max(revenue or [1]) * 1.25)
    _chart_style(ax)
    ax.legend(fontsize=5.8, frameon=False, loc="upper left", ncol=2, handlelength=0.9, columnspacing=0.7)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: _compact(v)))
    ax.set_ylabel(_currency(payload), fontsize=6, color="#64748B")
    return _fig_bytes(fig)


def chart_forecast(payload: dict[str, Any]) -> bytes | None:
    periods = payload.get("forecast", {}).get("periods") or []
    if not CHARTS_OK or not periods:
        return None
    labels = _forecast_labels(payload)[: len(periods)]
    revenue = [p.get("revenue") or 0 for p in periods]
    ebitda = [p.get("ebitda") or 0 for p in periods]
    fcf = [p.get("fcf") or 0 for p in periods]
    x = range(len(periods))
    width = 0.3
    fig, ax = plt.subplots(figsize=(3.35, 1.6))
    ax.bar([i - width / 2 for i in x], revenue, width, color="#1D4ED8", label="Revenue")
    ax.bar([i + width / 2 for i in x], ebitda, width, color="#64748B", label="EBITDA")
    ax.plot(list(x), fcf, color="#B45309", linewidth=1.2, marker="o", markersize=2.2, label="FCF")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=5.8)
    ax.set_ylim(0, max(revenue or [1]) * 1.22)
    _chart_style(ax)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: _compact(v)))
    ax.legend(fontsize=5.8, frameon=False, loc="upper left", ncol=3, handlelength=0.9, columnspacing=0.7)
    ax.set_ylabel(_currency(payload), fontsize=6, color="#64748B")
    return _fig_bytes(fig)


def chart_bridge(payload: dict[str, Any]) -> bytes | None:
    dcf = payload.get("valuation", {}).get("dcf") or {}
    if not CHARTS_OK or dcf.get("error"):
        return None
    pv_cf = dcf.get("pv_cash_flows") or 0
    pv_tv = dcf.get("pv_terminal_value") or 0
    ev = dcf.get("enterprise_value") or 0
    net_debt = payload.get("valuation", {}).get("net_debt") or 0
    equity = ev - net_debt
    per_share = dcf.get("value_per_share") or 0
    current = (payload.get("price", {}) or {}).get("current")

    steps = [
        ("PV of FCF", pv_cf, "#1D4ED8"),
        ("+ PV of TV", pv_tv, "#64748B"),
        ("= EV", ev, "#0F2038"),
        ("− net debt", -net_debt, "#DC2626" if net_debt >= 0 else "#16A34A"),
        ("= Equity", equity, "#0B7A3E"),
    ]
    fig, ax = plt.subplots(figsize=(3.35, 1.65))
    running = 0.0
    for index, (label, value, color) in enumerate(steps):
        if label.startswith("= "):
            ax.bar(index, value, 0.55, color=color)
            running = value
        else:
            bottom = running if value >= 0 else running + value
            ax.bar(index, abs(value), 0.55, bottom=bottom, color=color)
            running += value
    axis_max = max(abs(pv_cf + pv_tv), abs(equity), abs(ev)) * 1.15
    ax.set_ylim(min(0.0, equity * 1.05), axis_max)
    ax.set_xticks(range(len(steps)))
    ax.set_xticklabels([label.replace(" ", "\n", 1) for label, *_ in steps], fontsize=5.4)
    _chart_style(ax)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: _compact(v)))
    if per_share:
        ax.text(
            0.02,
            0.96,
            f"≈ {_price(per_share)}/share" + (f" vs {_price(current)}" if current else ""),
            transform=ax.transAxes,
            fontsize=6,
            color="#0B7A3E",
            fontweight="bold",
            ha="left",
            va="top",
        )
    return _fig_bytes(fig)


def chart_scenarios(payload: dict[str, Any]) -> bytes | None:
    scenarios = payload.get("scenarios") or {}
    if not CHARTS_OK or not scenarios.get("base", {}).get("target_price"):
        return None
    names, targets, colors_ = [], [], []
    for label, color in (("bear", "#DC2626"), ("base", "#1D4ED8"), ("bull", "#16A34A")):
        value = (scenarios.get(label) or {}).get("target_price")
        if value:
            names.append(label)
            targets.append(value)
            colors_.append(color)
    if not targets:
        return None
    fig, ax = plt.subplots(figsize=(3.3, 1.5))
    ax.barh(range(len(targets)), targets, 0.5, color=colors_, alpha=0.85)
    ax.set_yticks(range(len(targets)))
    ax.set_yticklabels(names, fontsize=6.4, style="italic")
    current = (payload.get("price", {}) or {}).get("current")
    if current:
        ax.axvline(current, color="#0F2038", linewidth=1.0, linestyle=(0, (3, 2)))
        ax.annotate(f"price {_price(current)}", (current, len(targets) - 0.4), fontsize=5.6, color="#0F2038", ha="left")
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color("#94A3B8")
    ax.tick_params(colors="#64748B", labelsize=6.2, length=0)
    ax.grid(axis="x", color="#E2E8F0", linewidth=0.5)
    ax.set_axisbelow(True)
    ax.set_xlim(0, max(targets + ([current] if current else [])) * 1.18)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: _num(v, 0)))
    return _fig_bytes(fig)


# --------------------------------------------------------------------------- #
# page furniture
# --------------------------------------------------------------------------- #

class NumberedCanvas(_canvas_module.Canvas):
    """Adds a running header (body pages) and footer via two-pass save."""

    def __init__(self, *args, footer_text: str = "APEX Research", header_text: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self._footer_text = footer_text
        self._header_text = header_text

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        total_body = max(0, num_pages - 1)  # cover excluded from numbering
        for index, state in enumerate(self._saved_page_states):
            self.__dict__.update(state)
            self.draw_furniture(num_pages, index, total_body)
            _canvas_module.Canvas.showPage(self)
        _canvas_module.Canvas.save(self)

    def draw_furniture(self, num_pages: int, index: int, total_body: int):
        self.saveState()
        if index > 0 and self._header_text:
            self.setFont("Helvetica", 6.4)
            self.setFillColor(MUTED)
            self.drawString(MARGIN, PAGE_H - 11 * mm, self._header_text)
            self.setFont("Helvetica-Bold", 6.4)
            self.setFillColor(INK)
            self.drawRightString(PAGE_W - MARGIN, PAGE_H - 11 * mm, "APEX RESEARCH")
            self.setStrokeColor(LINE)
            self.setLineWidth(0.5)
            self.line(MARGIN, PAGE_H - 13 * mm, PAGE_W - MARGIN, PAGE_H - 13 * mm)
        self.setStrokeColor(LINE)
        self.setLineWidth(0.5)
        self.line(MARGIN, 10.5 * mm, PAGE_W - MARGIN, 10.5 * mm)
        self.setFont("Helvetica", 6.4)
        self.setFillColor(MUTED)
        self.drawString(MARGIN, 6.4 * mm, self._footer_text)
        if index > 0:
            self.drawRightString(PAGE_W - MARGIN, 6.4 * mm, f"Page {index} of {total_body}")
        self.restoreState()


def canvasmaker(footer_text: str, header_text: str = ""):
    def _make(*args, **kwargs):
        return NumberedCanvas(*args, footer_text=footer_text, header_text=header_text, **kwargs)

    return _make


# --------------------------------------------------------------------------- #
# narrative helpers
# --------------------------------------------------------------------------- #

def _arr(value: Any) -> list[str]:
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str):
        return [value]
    return []


def _ai_tag(payload: dict[str, Any]) -> Paragraph | None:
    model = payload.get("narrative_model")
    if not model and not payload.get("narrative"):
        return None
    return Paragraph(
        f"AI-assisted narrative{f' ({_escape(model)})' if model else ''} — qualitative interpretation only; "
        "all figures come from the deterministic engines.",
        S["note"],
    )


def _currency(payload: dict[str, Any]) -> str:
    return str((payload.get("meta") or {}).get("currency") or "USD")


def _unit_label(payload: dict[str, Any], compact_unit: bool = True) -> str:
    cur = _currency(payload)
    if compact_unit:
        return f"{_currency_symbol(cur)} (compact)".strip()
    return cur


def _div(payload: dict[str, Any]) -> dict[str, Any]:
    """Dividend block lives under price.dividend in the payload."""
    price_div = (payload.get("price") or {}).get("dividend") or {}
    top = payload.get("dividends") or {}
    if isinstance(top, dict) and top.get("available"):
        return top
    return price_div if isinstance(price_div, dict) else {}


def _hist(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Historical metrics, oldest → newest."""
    return list((payload.get("historical") or {}).get("metrics") or [])[::-1]


def _hist_labels(payload: dict[str, Any]) -> list[str]:
    return list((payload.get("historical") or {}).get("periods") or [])[::-1]


def _latest(payload: dict[str, Any]) -> dict[str, Any]:
    metrics = (payload.get("historical") or {}).get("metrics") or []
    return metrics[0] if metrics else {}


# --------------------------------------------------------------------------- #
# cover page
# --------------------------------------------------------------------------- #

def _rating_banner(payload: dict[str, Any], cfg: dict[str, Any]) -> list:
    rating = payload.get("rating") or {}
    price = payload.get("price") or {}
    rating_key = str(rating.get("code") or "NOT RATED").upper()
    bg = RATING_BG.get(rating_key, RATING_BG["NOT RATED"])
    target = _price(rating.get("target_price"), _currency(payload))
    current = _price(price.get("current"), _currency(payload))
    upside = _signed_pct(rating.get("upside"))
    horizon = str(rating.get("horizon") or "12M")
    price_date = str(price.get("price_date") or "")[:10]
    divs = _div(payload)
    yield_note = f"· div. yield {_pct(divs.get('yield'))}" if divs.get("yield") is not None else ""
    period_note = f"price as of {price_date}" if price_date else ""

    values = Table(
        [[
            Paragraph(f'<font color="white"><b>{_escape(rating_key)}</b><br/><font size="6.5">{_escape(horizon)} horizon</font></font>',
                      ParagraphStyle("rb", fontName="Helvetica-Bold", fontSize=13, leading=15, alignment=TA_CENTER)),
            Paragraph(f'<font color="white"><b>{target}</b></font>',
                      ParagraphStyle("rt", fontName="Helvetica-Bold", fontSize=13, leading=15, alignment=TA_CENTER)),
            Paragraph(f'<font color="white"><b>{current}</b></font><br/><font size="6.3" color="#E2E8F0">{_escape(period_note)}</font>',
                      ParagraphStyle("rp", fontName="Helvetica-Bold", fontSize=13, leading=15, alignment=TA_CENTER)),
            Paragraph(f'<font color="white"><b>{upside}</b></font><br/><font size="6.3" color="#E2E8F0">{yield_note}</font>',
                      ParagraphStyle("ru", fontName="Helvetica-Bold", fontSize=13, leading=15, alignment=TA_CENTER)),
        ]],
        colWidths=[CONTENT_W * 0.25] * 4,
    )
    values.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), bg),
        ("BACKGROUND", (1, 0), (1, 0), INK),
        ("BACKGROUND", (2, 0), (2, 0), INK),
        ("BACKGROUND", (3, 0), (3, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    labels = Table([[_cell(c, "left", muted=True) for c in ("RATING", "TARGET", "PRICE", "UPSIDE")]],
                   colWidths=[CONTENT_W * 0.25] * 4)
    labels.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), FILL),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    grid = Table([[labels], [values]], colWidths=[CONTENT_W])
    grid.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                              ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    reasons = rating.get("reasons") or []
    rationale = str(cfg.get("rating_note") or rating.get("rationale") or (reasons[0] if reasons else "")).strip()
    out: list = [grid]
    if rationale:
        out.append(Paragraph(_escape(rationale), S["body_sm"]))
    else:
        out.append(Paragraph("Target is the valuation-derived fair value over the stated horizon.", S["body_muted"]))
    return out


def _market_table(payload: dict[str, Any], compact: bool = False) -> Table:
    meta = payload.get("meta") or {}
    price = payload.get("price") or {}
    divs = _div(payload)
    cur = _currency(payload)
    latest = _latest(payload)
    fy_end = str(latest.get("period_end") or "")[:10]
    if compact:
        rows = [
            [_cell("Market cap", muted=True), _cell(_money(meta.get("market_cap") or price.get("market_cap"), cur), align="right")],
            [_cell("Shares out.", muted=True), _cell(_compact(meta.get("shares") or price.get("shares_outstanding")), align="right")],
            [_cell("Dividend (TTM)", muted=True),
             _cell((_price(divs.get("ttm_per_share"), cur) if divs.get("available") else "—"), align="right")],
            [_cell("Sector", muted=True), _cell(_escape(str(meta.get("sector") or "—")), align="right")],
            [_cell("Exchange / ccy", muted=True),
             _cell(f"{_escape(str(meta.get('exchange') or price.get('exchange') or '—'))} / {_escape(cur)}", align="right")],
            [_cell("Employees", muted=True), _cell(_compact(meta.get("employees")), align="right")],
        ]
        return _t(["MARKET DATA", ""], rows,
                  [CONTENT_W * 0.22, CONTENT_W * 0.2],
                  style_opts=[("ALIGN", (0, 0), (-1, 0), "LEFT")])
    rows = [
        [_cell("Market cap", muted=True), _cell(_money(meta.get("market_cap") or price.get("market_cap"), cur), align="right"),
         _cell("52-week range", muted=True), _cell(f"{_price(price.get('low_52w'), cur)} – {_price(price.get('high_52w'), cur)}", align="right")],
        [_cell("Shares out.", muted=True), _cell(_compact(meta.get("shares") or price.get("shares_outstanding")), align="right"),
         _cell("Avg volume (3m)", muted=True), _cell(_compact(price.get("avg_volume_3m")), align="right")],
        [_cell("Dividend (TTM)", muted=True),
         _cell((_price(divs.get("ttm_per_share"), cur) if divs.get("available") else "—"), align="right"),
         _cell("Dividend yield", muted=True), _cell(_pct(divs.get("yield")), align="right")],
        [_cell("Sector", muted=True), _cell(_escape(str(meta.get("sector") or "—")), align="right"),
         _cell("Industry", muted=True), _cell(_escape(str(meta.get("industry") or "—")), align="right")],
        [_cell("Exchange / ccy", muted=True),
         _cell(f"{_escape(str(meta.get('exchange') or price.get('exchange') or '—'))} / {_escape(cur)}", align="right"),
         _cell("Latest FY end", muted=True), _cell(_escape(fy_end or "—"), align="right")],
        [_cell("Employees", muted=True), _cell(_compact(meta.get("employees")), align="right"),
         _cell("Data source", muted=True),
         _cell(_escape(str(price.get("source_note") or payload.get("schema") or "—")), align="right")],
    ]
    return _t(["MARKET DATA", "", "TRADING & VALUATION", ""], rows,
              [CONTENT_W * 0.17, CONTENT_W * 0.33, CONTENT_W * 0.17, CONTENT_W * 0.33],
              style_opts=[("SPAN", (0, 0), (1, 0)), ("SPAN", (2, 0), (3, 0)),
                          ("ALIGN", (0, 0), (-1, 0), "LEFT")])


def _fmt_cell(value: Any, fmt: str) -> str:
    if value is None:
        return "—"
    if fmt == "money":
        return _money(value)
    if fmt == "pct":
        return _pct(value)
    if fmt == "eps":
        return _num(value)
    return _num(value) if _finite(value) is not None else str(value)


def _highlights_table(payload: dict[str, Any]) -> Table:
    snap = payload.get("summary_snapshot") or {}
    hist_labels = snap.get("labels") or []
    fc_labels = snap.get("forecast_labels") or []
    if not hist_labels and not fc_labels:
        raise ValueError("summary_snapshot has no columns")
    rows = snap.get("rows") or []

    cols = hist_labels + fc_labels
    forecast_from = len(hist_labels)
    header = [_th("Snapshot", "left")] + [_th(label) for label in cols]
    body: list = []
    for row in rows:
        label = row.get("label") or ""
        values = list(row.get("values") or [])
        forecast = list(row.get("forecast") or [])
        fmt = str(row.get("fmt") or "num")
        bold = label in ("Revenue", "Free cash flow")
        cells = [(_cell(label, "left", bold=bold))]
        for index in range(len(hist_labels)):
            cells.append(_cell(_fmt_cell(values[index] if index < len(values) else None, fmt), align="right", forecast=False))
        for index in range(len(fc_labels)):
            cells.append(_cell(_fmt_cell(forecast[index] if index < len(forecast) else None, fmt), align="right", forecast=True))
        body.append(cells)
    widths = [CONTENT_W * 0.16] + [(CONTENT_W * 0.84) / max(1, len(cols))] * len(cols)
    return _t(header, body, widths, forecast_from=forecast_from)


def _catalysts_cover(payload: dict[str, Any]) -> list[str]:
    narrative = payload.get("narrative") or {}
    catalysts = _arr(narrative.get("key_questions") or narrative.get("catalysts"))
    if catalysts:
        return catalysts[:4]
    quarters = payload.get("historical", {}).get("quarterly_metrics") or []
    forecast = payload.get("forecast", {}).get("periods") or []
    items: list[str] = []
    if quarters and forecast:
        latest_q = quarters[0]
        items.append(
            f"Next quarterly print vs the model's path: revenue {_pct(forecast[0].get('revenue_growth'))} "
            f"in {_forecast_labels(payload)[0]} on base quarterly revenue of {_money(latest_q.get('revenue'), _currency(payload))} "
            "(see forecast drivers)."
        )
    dividends = _div(payload)
    if dividends.get("available") and dividends.get("ttm_per_share"):
        items.append(
            f"Dividend continuity: TTM payout of {_price(dividends.get('ttm_per_share'), _currency(payload))} "
            f"({_pct(dividends.get('yield'))} yield, last paid {dividends.get('last_payment') or '—'}) against the modelled payout assumption."
        )
    dcf = payload.get("valuation", {}).get("dcf") or {}
    if not dcf.get("error") and dcf.get("value_per_share"):
        items.append(
            f"Value re-rating toward the DCF fair value of {_price(dcf.get('value_per_share'), _currency(payload))} "
            "as forecast cash flows are delivered."
        )
    if not items:
        items.append("Next earnings release and quarterly performance against model assumptions.")
    return items[:4]


def _risks_cover(payload: dict[str, Any]) -> list[str]:
    narrative = payload.get("narrative") or {}
    risks = _arr(narrative.get("bear_case") or narrative.get("key_risks"))
    if risks:
        return risks[:4]
    items: list[str] = []
    dcf = payload.get("valuation", {}).get("dcf") or {}
    if not dcf.get("error"):
        ev = _finite(dcf.get("enterprise_value")) or 0
        pv_tv = _finite(dcf.get("pv_terminal_value")) or 0
        if ev:
            share = pv_tv / ev
            if share > 0.55:
                items.append(
                    f"Terminal-value dependence: {share * 100:.0f}% of enterprise value sits beyond the explicit "
                    "forecast horizon — fair value is sensitive to the discount rate and exit assumptions."
                )
            else:
                items.append(
                    f"Valuation rests on long-dated cash flows ({share * 100:.0f}% terminal-value share) — sensitive "
                    "to discount-rate and growth changes."
                )
    latest = _latest(payload)
    if latest.get("net_debt") is not None and (latest.get("net_debt") or 0) > 0:
        items.append(
            f"Leverage: net debt of {_money(latest.get('net_debt'), _currency(payload))} must be serviced from "
            f"operating cash flow (net debt / EBITDA {_num(latest.get('net_debt_ebitda'))}x)."
        )
    qc_items = payload.get("qc") or []
    warnings = [q for q in qc_items if isinstance(q, dict) and q.get("level") in ("warning", "error")]
    if warnings:
        items.append(f"Data quality: {warnings[0].get('detail') or warnings[0].get('check')}")
    quality = payload.get("data_quality") or {}
    if quality.get("demo") or (payload.get("meta") or {}).get("demo"):
        items.append("Sample (demo) data — figures are illustrative and do not represent a real company.")
    if not items:
        items.append("Execution risk on the forecast assumptions and changes in the cost of capital.")
    return items[:4]


def _thesis_cover(payload: dict[str, Any], cfg: dict[str, Any]) -> list[str]:
    bullets = _arr((payload.get("narrative") or {}).get("bull_case"))[:4]
    if bullets:
        return bullets
    return _deterministic_thesis(payload, cfg)


def _deterministic_thesis(payload: dict[str, Any], cfg: dict[str, Any]) -> list[str]:
    cur = _currency(payload)
    bullets: list[str] = []
    rating = payload.get("rating") or {}
    price = payload.get("price") or {}
    if rating.get("target_price") and price.get("current"):
        bullets.append(
            f"Valuation gap: fair value of {_price(rating.get('target_price'), cur)} versus the current price of "
            f"{_price(price.get('current'), cur)} implies {_signed_pct(rating.get('upside'))} upside over the stated horizon "
            f"(rating {_escape(str(rating.get('code') or 'NOT RATED'))})."
        )
    hist = _hist(payload)
    hist_labels = _hist_labels(payload)
    fc = payload.get("forecast", {}).get("periods") or []
    if len(hist) >= 2 and hist[0].get("revenue") and hist[-1].get("revenue"):
        first, last = hist[0], hist[-1]
        n = len(hist) - 1
        cagr = (last["revenue"] / first["revenue"]) ** (1 / n) - 1 if n > 0 and first["revenue"] else None
        if cagr is not None:
            first_label = hist_labels[0] if hist_labels else str(first.get("period_end") or "")[:4]
            last_label = hist_labels[-1] if hist_labels else str(last.get("period_end") or "")[:4]
            bullets.append(
                f"Earnings trajectory: revenue compounded at {_pct(cagr)} p.a. from {_money(first.get('revenue'), cur)} "
                f"({first_label}) to {_money(last.get('revenue'), cur)} ({last_label}); "
                f"net margin is now {_pct(last.get('net_margin'))}."
            )
    if hist:
        last = hist[-1]
        if last.get("fcf") is not None and last.get("net_income"):
            conv = (last["fcf"] / last["net_income"]) if last["net_income"] else None
            if conv is not None:
                bullets.append(
                    f"Cash generation: FY free cash flow of {_money(last.get('fcf'), cur)} equals "
                    f"{_pct(conv)} of net income; net debt of {_money(last.get('net_debt'), cur)}."
                )
    scenarios = payload.get("scenarios") or {}
    bear = (scenarios.get("bear") or {}).get("target_price")
    bull = (scenarios.get("bull") or {}).get("target_price")
    if bear and bull and price.get("current"):
        cur_p = price["current"]
        bullets.append(
            f"Scenario range: {_price(bear, cur)} bear-case to {_price(bull, cur)} bull-case around the base case "
            f"(current price {_price(cur_p, cur)})."
        )
    dividends = _div(payload)
    if dividends.get("available") and dividends.get("ttm_per_share"):
        bullets.append(
            f"Income: TTM dividend of {_price(dividends.get('ttm_per_share'), cur)} a share, a "
            f"{_pct(dividends.get('yield'))} yield at the current price."
        )
    if fc:
        labels = _forecast_labels(payload)
        latest_growth = hist[-1].get("revenue_growth") if hist else None
        bullets.append(
            f"Forecast: latest reported revenue growth of {_pct(latest_growth)} trends toward "
            f"{_pct(fc[0].get('revenue_growth'))} in {labels[0]} with EBITDA margin at {_pct(fc[0].get('ebitda_margin'))} "
            "(see forecast drivers)."
        )
    return bullets[:5]


def cover(payload: dict[str, Any], cfg: dict[str, Any], quick: bool = False) -> list:
    meta = payload.get("meta") or {}
    price = payload.get("price") or {}
    title = str(cfg.get("report_title") or "").strip()
    currency = _currency(payload)
    ticker = str(payload.get("ticker") or "")
    name = str(meta.get("name") or ticker)
    exchange = str(meta.get("exchange") or price.get("exchange") or "")
    industry = str(meta.get("industry") or "")
    sector = str(meta.get("sector") or "")
    as_of = str(cfg.get("report_date") or payload.get("report_date") or datetime.now(timezone.utc).date().isoformat())[:10]
    source_note = str(price.get("source_note") or "the data source")

    story: list = []
    brand = Table(
        [[Paragraph('<font size="13" color="#0A2540"><b>APEX RESEARCH</b></font>', S["body"]),
          Paragraph(f'<font size="7.5" color="#64748B">{_escape(as_of)} · Equity research</font>',
                    ParagraphStyle("brand_r", alignment=TA_RIGHT, fontSize=7.5, textColor=MUTED))]],
        colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5],
    )
    brand.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [brand, Spacer(1, 2), Rule(CONTENT_W, INK, 2.6), Spacer(1, 6)]

    story.append(Paragraph(_escape(name), S["h1"]))
    identity = " · ".join(part for part in (ticker, exchange, industry or sector, currency) if part)
    subtitle_bits = [identity]
    if title:
        subtitle_bits.insert(0, title)
    story.append(Paragraph(" — ".join([_escape(subtitle_bits[0])] + [_escape(b) for b in subtitle_bits[1:]]), S["h1_sub"]))
    story.append(Spacer(1, 4))

    story += _rating_banner(payload, cfg)
    story.append(Spacer(1, 4))

    chart = chart_price(payload)
    left = [_market_table(payload, compact=True)]
    if chart:
        right = _captioned(
            _make_image(chart, CONTENT_W * 0.44),
            f"Close price, dashed line = 12M target (source: {_escape(source_note)}; last dated "
            f"{price.get('price_date') or '—'}).",
        )
    else:
        right = [Paragraph("Price history unavailable for this dataset.", S["body_muted"])]
    story.append(_two_up(left, right))
    story.append(Spacer(1, 4))

    narrative = payload.get("narrative") or {}
    story.append(Paragraph("Company and investment snapshot", S["subsection"]))
    snapshot_text = str(narrative.get("conclusion") or "").strip()
    if not snapshot_text:
        rating = payload.get("rating") or {}
        call = ""
        if rating.get("target_price") and price.get("current"):
            call = (
                f" {_escape(str(rating.get('code') or 'NOT RATED'))} with a fair value of "
                f"{_price(rating.get('target_price'), currency)} versus the last close of "
                f"{_price(price.get('current'), currency)} ({_signed_pct(rating.get('upside'))} implied upside, "
                f"{rating.get('horizon') or '12M'} horizon)."
            )
        snapshot_text = (str(meta.get("summary") or "").strip()[:320] + call).strip()
    story.append(Paragraph(_escape(snapshot_text[:800]), S["body_sm"]))

    story.append(Paragraph("Central investment arguments", S["subsection"]))
    for bullet in _thesis_cover(payload, cfg)[:4]:
        story.append(Paragraph(_escape(bullet), S["bullet_sm"], bulletText="•"))

    two_col = Table(
        [[
            [Paragraph("Near-term catalysts", S["subsection"])] +
            [Paragraph(_escape(b), S["bullet_sm"], bulletText="•") for b in _catalysts_cover(payload)[:2]],
            [Paragraph("Principal risks", S["subsection"])] +
            [Paragraph(_escape(b), S["bullet_sm"], bulletText="•") for b in _risks_cover(payload)[:2]],
        ]],
        colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5],
    )
    two_col.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (0, 0), 0),
                                 ("RIGHTPADDING", (1, 0), (1, 0), 0), ("LEFTPADDING", (1, 0), (1, 0), 6)]))
    story += [two_col, Spacer(1, 3)]

    story.append(Paragraph("Financial highlights — actual vs forecast", S["subsection"]))
    story.append(_highlights_table(payload))
    story.append(source_line(
        f"reported financials from {_escape(source_note)}; forecast from APEX models. "
        "Italic blue-tinted columns are model forecasts, not company guidance."
    ))

    # data freshness and limitations strip
    quality = payload.get("data_quality") or {}
    freshness_bits: list[str] = []
    price_date = str(price.get("price_date") or "")[:10]
    if price_date:
        freshness_bits.append(f"price dated {price_date}")
    retrieved = str(quality.get("retrieved_at") or payload.get("retrieved_at") or "")[:19]
    if retrieved:
        freshness_bits.append(f"data retrieved {retrieved}")
    gaps = payload.get("gaps") or []
    if gaps:
        first_gap = gaps[0]
        freshness_bits.append(f"gap: {str(first_gap.get('area') or '')} — {str(first_gap.get('detail') or '')}"[:150])
    freshness_bits.append("figures shown as em-dashes are unavailable, never estimated")
    story.append(Paragraph(_escape("Data note: " + "; ".join(freshness_bits) + "."), S["note"]))
    story.append(PageBreak())
    return story


# --------------------------------------------------------------------------- #
# body sections
# --------------------------------------------------------------------------- #

def _toc_section() -> list:
    """Contents page for full reports; entries are the numbered section titles."""
    story: list = [Rule(CONTENT_W, ACCENT, 2.2, space_before=4, space_after=1)]
    story.append(Paragraph("CONTENTS", S["eyebrow"]))
    story.append(Paragraph("Contents", S["section"]))
    story.append(Paragraph("Report structure for this note.", S["body_muted"]))
    story.append(Spacer(1, 4))
    entries = [
        "Executive summary",
        "Investment thesis and scenarios",
        "Company and business overview",
        "Financial performance",
        "Operating drivers and peer comparison",
        "Valuation",
        "Forecast drivers and assumptions",
        "Appendix — reported statements",
        "Investment conclusion",
        "Risks and monitoring",
        "Sources, provenance and methodology",
        "Data gaps and quality control",
        "Disclosures",
    ]
    for index, entry in enumerate(entries, start=1):
        story.append(Paragraph(_escape(f"{index}.  {entry}"), S["toc_entry"]))
    story.append(Spacer(1, 6))
    return story


def _executive_summary(payload: dict[str, Any], cfg: dict[str, Any]) -> list:
    """Decision-useful opening page: recommendation, thesis, findings, risks, valuation, scenarios."""
    story = section(
        "Executive summary",
        subtitle="The recommendation, the argument behind it, and the numbers that matter.",
        eyebrow="Summary",
        min_space=320,
    )
    rating = payload.get("rating") or {}
    price = payload.get("price") or {}
    cur = _currency(payload)
    code = str(rating.get("code") or "NOT RATED")
    target = rating.get("target_price")
    current = price.get("current")
    upside = rating.get("upside")
    horizon = str(rating.get("horizon") or "12M")

    # metrics strip — compact table, not oversized cards
    strip_head = [_th("Recommendation", "left"), _th("Target price"), _th("Market price"),
                  _th("Implied upside"), _th("Horizon"), _th("Confidence", "left")]
    confidence = str((payload.get("narrative") or {}).get("confidence") or "—")
    strip_body = [[
        _cell(code, "left", bold=True),
        _cell(_price(target, cur), align="right", bold=True),
        _cell(_price(current, cur), align="right"),
        _cell(_signed_pct(upside), align="right", bold=True),
        _cell(horizon, align="right"),
        _cell(confidence.capitalize(), "left", muted=True),
    ]]
    story.append(_t(strip_head, strip_body, [CONTENT_W * 0.2, CONTENT_W * 0.15, CONTENT_W * 0.15,
                                             CONTENT_W * 0.15, CONTENT_W * 0.12, CONTENT_W * 0.23]))
    story.append(Spacer(1, 4))

    narrative = payload.get("narrative") or {}
    thesis_text = str(narrative.get("central_thesis") or "").strip()
    if not thesis_text:
        thesis_text = _deterministic_thesis(payload, cfg)[0] if _deterministic_thesis(payload, cfg) else ""
    story.append(Paragraph("Investment thesis", S["subsection"]))
    story.append(Paragraph(_escape(thesis_text[:1200]), S["body"]))

    # three to five major findings
    findings = _arr(narrative.get("value_drivers"))[:3] or _deterministic_thesis(payload, cfg)[1:4]
    if findings:
        story.append(Paragraph("Major findings", S["subsection"]))
        for finding in findings[:5]:
            story.append(Paragraph(_escape(finding), S["bullet_sm"], bulletText="•"))

    risks = _arr(narrative.get("key_risks"))[:3] or _risks_cover(payload)[:3]
    story.append(Paragraph("Key risks", S["subsection"]))
    for risk in risks:
        story.append(Paragraph(_escape(risk), S["bullet_sm"], bulletText="•"))

    # valuation summary + scenario comparison
    dcf = payload.get("valuation", {}).get("dcf") or {}
    scenarios = payload.get("scenarios") or {}
    story.append(Paragraph("Valuation and scenarios", S["subsection"]))
    val_bits = []
    if dcf.get("value_per_share"):
        val_bits.append(f"DCF fair value {_price(dcf.get('value_per_share'), cur)}")
    wacc = (payload.get("valuation") or {}).get("wacc")
    if wacc is not None:
        val_bits.append(f"WACC {_pct(wacc)}")
    tv_share = None
    if _finite(dcf.get("enterprise_value")) and _finite(dcf.get("pv_terminal_value")) and dcf.get("enterprise_value"):
        tv_share = dcf["pv_terminal_value"] / dcf["enterprise_value"]
    if tv_share is not None:
        val_bits.append(f"{_pct(tv_share, 0)} of value beyond the explicit horizon")
    reverse = (payload.get("valuation") or {}).get("reverse_dcf") or {}
    if reverse.get("implied_wacc") is not None:
        val_bits.append(f"the market price implies {_pct(reverse.get('implied_wacc'))} WACC")
    if val_bits:
        story.append(Paragraph(_escape("; ".join(val_bits) + "."), S["body_sm"]))
    bear = (scenarios.get("bear") or {}).get("target_price")
    base = (scenarios.get("base") or {}).get("target_price")
    bull = (scenarios.get("bull") or {}).get("target_price")
    if bear and base and bull:
        story.append(Paragraph(
            _escape(f"Scenario range: bear {_price(bear, cur)} · base {_price(base, cur)} · bull {_price(bull, cur)} "
                    f"around the last close of {_price(current, cur)}."),
            S["body_sm"],
        ))
    story.append(_ai_tag(payload) or Spacer(1, 0))
    story.append(Spacer(1, 3))
    return story


def _thesis_section(payload: dict[str, Any], cfg: dict[str, Any]) -> list:
    story: list = section(
        "Investment thesis and scenarios",
        subtitle="Price target, scenario values and the conditions under which the view changes.",
        eyebrow="View",
    )
    story.append(_ai_tag(payload) or Spacer(1, 0))
    bullets = _arr((payload.get("narrative") or {}).get("investment_thesis")) or _deterministic_thesis(payload, cfg)
    for bullet in bullets[:6]:
        story.append(Paragraph(_escape(bullet), S["bullet"], bulletText="•"))
    story.append(Spacer(1, 3))

    scenarios = payload.get("scenarios") or {}
    cur = _currency(payload)
    current_price = _finite((payload.get("price") or {}).get("current"))
    head = [_th("Scenario", "left"), _th("Value"), _th("Upside"), _th("Premise", "left")]
    body: list = []
    design = str(scenarios.get("design") or "").strip()
    for key in ("bear", "base", "bull"):
        node = scenarios.get(key) or {}
        value = node.get("target_price")
        if value is None:
            continue
        upside = (value / current_price - 1) if (current_price and value is not None) else None
        wacc_s = _pct(node.get("wacc"), 1) if node.get("wacc") is not None else None
        gdelta = _signed_pct(node.get("growth_delta")) if node.get("growth_delta") else None
        if key == "base":
            premise = design or "Base-case forecast discounted at the model WACC."
        elif key == "bear":
            premise = f"Revenue growth {gdelta or 'lower'} and WACC {wacc_s or 'higher'}." if (gdelta or wacc_s) else "Slower growth / higher discount rate."
        else:
            premise = f"Revenue growth {gdelta or 'higher'} and WACC {wacc_s or 'lower'}." if (gdelta or wacc_s) else "Faster growth / lower discount rate."
        if key == "base" and design and premise == design:
            premise = f"Base case at WACC {wacc_s or 'model'}; scenario design: {design}."
        body.append([_cell(key.capitalize(), "left", bold=key == "base"),
                     _cell(_price(value, cur), align="right", bold=key == "base"),
                     _cell(_signed_pct(upside), align="right", bold=key == "base"),
                     _cell(premise, "left")])
    if body:
        story.append(_t(head, body, [CONTENT_W * 0.12, CONTENT_W * 0.16, CONTENT_W * 0.14, CONTENT_W * 0.58]))
        story.append(source_line("APEX scenario model; upside measured against the last close."))
        story.append(Spacer(1, 3))

    chart = chart_scenarios(payload)
    if chart:
        story.append(_two_up(
            _captioned(_make_image(chart, CONTENT_W * 0.44), "Scenario price targets versus the last close."),
            _changes_view(payload),
        ))
        story.append(source_line("APEX scenario model."))
    else:
        story += _changes_view(payload)
    return story


def _changes_view(payload: dict[str, Any]) -> list:
    out: list = [Paragraph("What would change our view", S["subsection"])]
    items: list[str] = []
    dcf = payload.get("valuation", {}).get("dcf") or {}
    sens = payload.get("valuation", {}).get("sensitivity") or {}
    base = _finite(dcf.get("value_per_share"))
    cur = _currency(payload)
    if base and not dcf.get("error"):
        waccs = sens.get("wacc_values") or []
        grid = sens.get("table") or []
        base_wacc = _finite(dcf.get("wacc"))
        if waccs and grid and base_wacc is not None:
            # column at the base terminal growth (middle of the grid)
            col = len((sens.get("terminal_values") or [])) // 2
            def _cell_value(w: float) -> float | None:
                idx = min(range(len(waccs)), key=lambda i: abs(waccs[i] - w))
                try:
                    return _finite(grid[idx][col])
                except (IndexError, TypeError):
                    return None
            down_w = base_wacc + 0.01
            up_w = base_wacc - 0.01
            down_v = _cell_value(down_w)
            up_v = _cell_value(up_w)
            if down_v:
                items.append(
                    f"A 1 pp higher discount rate ({_pct(base_wacc + 0.01, 1)} vs {_pct(base_wacc, 1)}) cuts fair value to "
                    f"{_price(down_v, cur)} ({_signed_pct(down_v / base - 1)} vs base)."
                )
            if up_v:
                items.append(
                    f"A 1 pp lower discount rate ({_pct(base_wacc - 0.01, 1)}) lifts fair value to {_price(up_v, cur)} "
                    f"({_signed_pct(up_v / base - 1)} vs base)."
                )
    reverse = payload.get("valuation", {}).get("reverse_dcf") or {}
    if reverse.get("implied_wacc") is not None and dcf.get("wacc") is not None:
        gap = reverse["implied_wacc"] - dcf["wacc"]
        items.append(
            f"The market price already discounts {_pct(reverse.get('implied_wacc'), 1)} WACC "
            f"({_signed_pct(gap, 1)} pp versus the model's {_pct(dcf.get('wacc'), 1)}) — a cheaper cost of capital would "
            "be required to justify the current price on DCF terms."
        )
    quarters = payload.get("historical", {}).get("quarterly_metrics") or []
    fc = payload.get("forecast", {}).get("periods") or []
    if quarters and fc:
        items.append(
            f"Quarterly revenue sustaining above {_money(fc[0].get('revenue'), cur)} with EBITDA margin "
            f"at or above {_pct(fc[0].get('ebitda_margin'))} would support the base case."
        )
    narrative = payload.get("narrative") or {}
    questions = _arr(narrative.get("key_questions"))
    items += questions[:2]
    if not items:
        items.append("A material change to revenue growth, margins or the cost of capital versus the model.")
    for item in items[:5]:
        out.append(Paragraph(_escape(item), S["bullet_sm"], bulletText="•"))
    return out


def _company_section(payload: dict[str, Any]) -> list:
    meta = payload.get("meta") or {}
    price = payload.get("price") or {}
    story = section(
        "Company and business overview",
        subtitle="What the company does, where it operates, and its reporting calendar.",
        eyebrow="Company",
    )
    summary = str(meta.get("summary") or "").strip()
    if summary:
        story.append(Paragraph(_escape(summary[:1600]), S["body"]))
    else:
        story.append(Paragraph(
            "No business description is available for this ticker in the current data source; see limitations and data gaps.",
            S["body_muted"],
        ))
    story.append(Spacer(1, 3))

    cur = _currency(payload)
    latest = _latest(payload)
    facts = [
        ("Legal name", meta.get("name") or "—"),
        ("Ticker / exchange", f"{payload.get('ticker') or '—'} · {meta.get('exchange') or '—'}"),
        ("Sector / industry", f"{meta.get('sector') or '—'} / {meta.get('industry') or '—'}"),
        ("Country / currency", f"{meta.get('country') or '—'} / {cur}"),
        ("Employees", _compact(meta.get("employees"))),
        ("Website", meta.get("website") or "—"),
        ("Latest FY end", str(latest.get("period_end") or "—")[:10]),
        ("Shares outstanding", _compact(meta.get("shares") or price.get("shares_outstanding"))),
        ("Data source / flag", f"{price.get('source_note') or '—'} · {payload.get('schema') or '—'}"),
    ]
    head = [_th("Fact", "left"), _th("Value", "left"), _th("Fact", "left"), _th("Value", "left")]
    body = []
    for index in range(0, len(facts), 2):
        pair = facts[index:index + 2]
        row = []
        for label, value in pair:
            row += [_cell(label, muted=True), _cell(_escape(value))]
        while len(row) < 4:
            row += [_cell(""), _cell("")]
        body.append(row)
    story.append(_t(head, body, [CONTENT_W * 0.17, CONTENT_W * 0.33, CONTENT_W * 0.17, CONTENT_W * 0.33]))
    story.append(source_line(f"{price.get('source_note') or 'data source'} · price dated {price.get('price_date') or '—'}."))

    narrative = payload.get("narrative") or {}
    competitive = str(narrative.get("competitive_position") or "").strip()
    if competitive:
        story.append(Paragraph("Competitive position", S["subsection"]))
        story.append(Paragraph(_escape(competitive), S["body"]))
    return story


def _financial_section(payload: dict[str, Any], quick: bool = False) -> list:
    hist = payload.get("historical", {})
    metrics = hist.get("metrics") or []
    story = section(
        "Financial performance",
        subtitle="Reported results, margins and cash conversion.",
        eyebrow="Financials",
    )
    if not metrics:
        story.append(Paragraph("No reported financial statements are available for this ticker.", S["body_muted"]))
        return story

    source_note = str((payload.get("price") or {}).get("source_note") or "the data source")
    chart_hist = chart_hist_earnings(payload)
    chart_marg = chart_margins(payload)
    chart_q = chart_quarterly(payload) if not quick else None
    left = _captioned(_make_image(chart_hist, CONTENT_W * 0.47), "Reported revenue, EBITDA and net income.") if chart_hist else []
    if chart_q:
        right = _captioned(_make_image(chart_q, CONTENT_W * 0.47), "Quarterly revenue and EBITDA (latest four quarters).")
    else:
        right = _captioned(_make_image(chart_marg, CONTENT_W * 0.47), "Reported margin profile.") if chart_marg else []
    if left or right:
        story.append(_two_up(left, right))
        story.append(source_line(f"reported financials from {source_note}."))
        story.append(Spacer(1, 3))
    if chart_q and chart_marg and not quick:
        marg_img = _captioned(_make_image(chart_marg, CONTENT_W * 0.47), "Reported margin profile.")
        story.append(_two_up(marg_img, _earnings_review(payload)))
        story.append(Spacer(1, 3))
    else:
        story += _earnings_review(payload)

    # metrics are newest-first; flip to oldest → newest for display
    metrics_asc = metrics[::-1]
    labels_asc = (hist.get("periods") or [])[::-1] or [str(m.get("period_end") or "")[:4] for m in metrics_asc]
    head = [_th("Ratio", "left")] + [_th(str(lab)) for lab in labels_asc]
    ratio_rows = [
        ("Revenue growth", lambda m: _pct(m.get("revenue_growth"))),
        ("EBITDA margin", lambda m: _pct(m.get("ebitda_margin"))),
        ("Net margin", lambda m: _pct(m.get("net_margin"))),
        ("ROE", lambda m: _pct(m.get("roe"))),
        ("ROA", lambda m: _pct(m.get("roa"))),
        ("ROIC", lambda m: _pct(m.get("roic"))),
        ("Current ratio", lambda m: _num(m.get("current_ratio"))),
        ("Debt / equity", lambda m: _num(m.get("debt_to_equity"))),
        ("Net debt / EBITDA", lambda m: _num(m.get("net_debt_ebitda"))),
        ("Asset turnover", lambda m: _num(m.get("asset_turnover"))),
        ("Cash conversion", lambda m: _num(m.get("cash_conversion"))),
        ("Payout ratio", lambda m: _pct(m.get("payout_ratio"))),
    ]
    body = []
    for label, fmt in ratio_rows:
        values = [fmt(m) for m in metrics_asc]
        if all(value == "—" for value in values):
            continue
        body.append([_cell(label, "left")] + [_cell(v, align="right") for v in values])
    widths = [CONTENT_W * 0.2] + [(CONTENT_W * 0.8) / len(metrics_asc)] * len(metrics_asc)
    story.append(_t(head, body, widths))
    story.append(source_line("computed by APEX metrics engine from reported statements."))

    quarters = hist.get("quarterly_metrics") or []
    q_labels = hist.get("quarterly_periods") or []
    if quarters and not quick:
        story.append(Paragraph("Quarterly results", S["subsection"]))
        story.append(_quarterly_table(payload, quarters, q_labels))
        story.append(source_line("quarterly statements from the data source; QoQ growth computed by APEX."))
    return story


def _earnings_review(payload: dict[str, Any]) -> list:
    narrative = payload.get("narrative") or {}
    review = str(narrative.get("earnings_review") or "").strip()
    out: list = [Paragraph("Earnings review", S["subsection"])]
    if review:
        out.append(Paragraph(_escape(review), S["body_sm"]))
        return out
    hist = payload.get("historical", {})
    metrics = hist.get("metrics") or []
    if metrics:
        labels = hist.get("periods") or []
        latest_label = str(labels[0]) if labels else str(metrics[0].get("period_end") or "")[:4]
        latest, prior = metrics[0], metrics[1] if len(metrics) > 1 else None
        bits = [
            f"{latest_label} revenue {_money(latest.get('revenue'), _currency(payload))} "
            f"({_signed_pct(latest.get('revenue_growth'))} y/y)."
        ]
        if prior:
            bits.append(
                f"EBITDA margin {_pct(latest.get('ebitda_margin'))} vs {_pct(prior.get('ebitda_margin'))} a year earlier; "
                f"net margin {_pct(latest.get('net_margin'))}."
            )
        if latest.get("fcf") is not None:
            bits.append(
                f"Free cash flow {_money(latest.get('fcf'), _currency(payload))} "
                f"(cash conversion {_num(latest.get('cash_conversion'))}x net income)."
            )
        out.append(Paragraph(_escape(" ".join(bits)), S["body_sm"]))
    return out


def _quarterly_table(payload: dict[str, Any], quarters: list[dict], labels: list[str]) -> Table:
    cur = _currency(payload)
    rows = quarters[::-1]  # oldest → newest
    cols = labels[::-1]
    head = [_th("Quarter", "left")] + [_th(c) for c in cols]
    revenues = [r.get("revenue") for r in rows]
    qoq: list[str] = ["—"]
    for index in range(1, len(revenues)):
        prev, now = revenues[index - 1], revenues[index]
        qoq.append(_signed_pct(now / prev - 1) if prev and now else "—")
    body = [
        [_cell("Revenue", "left")] + [_cell(_money(r.get("revenue"), cur), align="right") for r in rows],
        [_cell("QoQ growth", "left")] + [_cell(v, align="right") for v in qoq],
        [_cell("EBITDA", "left")] + [_cell(_money(r.get("ebitda"), cur), align="right") for r in rows],
        [_cell("EBITDA margin", "left")] + [_cell(_pct(r.get("ebitda_margin")), align="right") for r in rows],
        [_cell("Net income", "left")] + [_cell(_money(r.get("net_income"), cur), align="right") for r in rows],
        [_cell("Diluted EPS", "left")] + [_cell(_num(r.get("eps_diluted")), align="right") for r in rows],
    ]
    widths = [CONTENT_W * 0.2] + [(CONTENT_W * 0.8) / max(1, len(cols))] * len(cols)
    return _t(head, body, widths)


def _operating_section(payload: dict[str, Any], quick: bool = False) -> list:
    context = payload.get("market_context") or {}
    drivers = context.get("operating_drivers") or {}
    peers = context.get("peers") or {}
    story = section(
        "Operating drivers and peer comparison",
        subtitle="The metrics that drive the forecast, and where the company trades against listed peers.",
        eyebrow="Operations",
    )
    rows = drivers.get("rows") or []
    unavailable = drivers.get("unavailable") or []
    if rows:
        head = [_th("Driver", "left"), _th("Value"), _th("Basis", "left")]
        body = []
        for row in rows:
            kind = str(row.get("kind") or "")
            value = row.get("value")
            if kind == "pct":
                formatted = _pct(value)
            elif kind == "x":
                # day-count drivers are labelled "days" in the label text
                label_l = str(row.get("label") or "").lower()
                formatted = _num(value, 0) + "d" if "days" in label_l else _num(value) + "x"
            else:
                formatted = _num(value)
            body.append([
                _cell(str(row.get("label") or ""), "left"),
                _cell(formatted, align="right"),
                _cell("latest FY" if "latest" in str(row.get("label") or "").lower() else "derived", "left", muted=True),
            ])
        story.append(_t(head, body, [CONTENT_W * 0.56, CONTENT_W * 0.18, CONTENT_W * 0.26]))
        story.append(source_line("computed from reported statements; drivers feed the forecast model."))
    else:
        story.append(Paragraph("No structured operating drivers are available for this sector in the current data source.", S["body_muted"]))
    if unavailable:
        story.append(Paragraph(
            "Series not available in this dataset: " + ", ".join(_escape(u) for u in unavailable[:4]) + ".",
            S["note"],
        ))
    story.append(Spacer(1, 3))

    peer_rows = peers.get("rows") or []
    peer_note = peers.get("note")
    if peer_rows:
        story.append(Paragraph("Peer comparison", S["subsection"]))
        head = [_th("Ticker", "left"), _th("Name", "left"), _th("Price"), _th("Mkt cap"),
                _th("P/E"), _th("EV/EBITDA"), _th("P/B"), _th("Rev growth"), _th("Gross margin")]
        body = []
        for row in peer_rows:
            ccy = row.get("currency") or ""
            body.append([
                _cell(str(row.get("ticker") or "—"), "left", bold=True),
                _cell(str(row.get("name") or "—")),
                _cell(_price(row.get("price"), ccy), align="right"),
                _cell(_money(row.get("market_cap"), ccy), align="right"),
                _cell(_num(row.get("pe")), align="right"),
                _cell(_num(row.get("ev_ebitda")), align="right"),
                _cell(_num(row.get("pb")), align="right"),
                _cell(_pct(row.get("revenue_growth")), align="right"),
                _cell(_pct(row.get("gross_margin")), align="right"),
            ])
        widths = [CONTENT_W * 0.07, CONTENT_W * 0.18] + [(CONTENT_W * 0.75) / 7] * 7
        story.append(_t(head, body, widths))
        if peer_note:
            story.append(Paragraph(_escape(peer_note), S["note"]))
        else:
            story.append(source_line("peer figures as reported by each company in its own reporting currency; not FX-adjusted."))
    elif not quick:
        story.append(Paragraph(
            _escape(peer_note or "No peer set was provided and none could be derived automatically; peer multiples are shown as em-dashes rather than inferred."),
            S["body_muted"],
        ))
    return story


def _valuation_section(payload: dict[str, Any], quick: bool = False) -> list:
    valuation = payload.get("valuation") or {}
    dcf = valuation.get("dcf") or {}
    rating = payload.get("rating") or {}
    wacc_meta = valuation.get("wacc_meta") or {}
    winputs = wacc_meta.get("inputs") or {}
    cur = _currency(payload)
    story = section(
        "Valuation",
        subtitle="Discount-rate build-up, DCF mechanics, equity bridge, multiples and sensitivity.",
        eyebrow="Valuation",
    )

    rationale = str(valuation.get("rationale") or "").strip()
    if rationale:
        story.append(Paragraph(_escape(rationale), S["body"]))
    else:
        story.append(Paragraph(
            f"The {_escape(str(rating.get('code') or 'valuation'))} rating reflects DCF fair value "
            "versus the last close over the stated horizon.",
            S["body"],
        ))
    story.append(Spacer(1, 3))

    coe = None
    if winputs.get("risk_free") is not None and winputs.get("beta") is not None and winputs.get("market_premium") is not None:
        coe = winputs["risk_free"] + winputs["beta"] * winputs["market_premium"]
    after_tax_cod = None
    if winputs.get("cost_of_debt") is not None and winputs.get("tax_rate") is not None:
        after_tax_cod = winputs["cost_of_debt"] * (1 - winputs["tax_rate"])
    wacc_head = [_th("WACC input", "left"), _th("Value"), _th("Input", "left"), _th("Value")]
    wacc_rows = [
        ("Risk-free rate", _pct(winputs.get("risk_free")), "Market risk premium", _pct(winputs.get("market_premium"))),
        ("Levered beta", _num(winputs.get("beta")), "Cost of equity (CAPM)", _pct(coe)),
        ("Pre-tax cost of debt", _pct(winputs.get("cost_of_debt")), "After-tax cost of debt", _pct(after_tax_cod)),
        ("Equity weight", _pct(winputs.get("equity_weight")), "Debt weight", _pct(winputs.get("debt_weight"))),
        ("Tax rate", _pct(winputs.get("tax_rate")), "WACC mode", str(wacc_meta.get("mode") or "—")),
        ("Blended WACC", _pct(valuation.get("wacc")), "Terminal growth", _pct(valuation.get("terminal_growth"))),
    ]
    wacc_body = [
        [_cell(label, "left", bold=label == "Blended WACC"), _cell(value, align="right", bold=label == "Blended WACC"),
         _cell(label2, "left", bold=label2 in ("Terminal growth", "Blended WACC")), _cell(value2, align="right", bold=label2 in ("Terminal growth", "Blended WACC"))]
        for label, value, label2, value2 in wacc_rows
    ]
    story.append(_t(wacc_head, wacc_body, [CONTENT_W * 0.28, CONTENT_W * 0.22, CONTENT_W * 0.28, CONTENT_W * 0.22]))
    story.append(source_line("APEX valuation engine inputs; blended WACC uses market-value weights."))
    story.append(Spacer(1, 4))

    if not dcf.get("error"):
        story += _dcf_schedule(dcf, payload)
        story += _bridge_table(payload, dcf, cur)
    else:
        story.append(Paragraph(f"DCF unavailable: {_escape(dcf.get('error'))}.", S["body_muted"]))
        story.append(Spacer(1, 3))

    if not quick:
        chart_b = chart_bridge(payload)
        chart_f = chart_forecast(payload)
        left = _captioned(_make_image(chart_b, CONTENT_W * 0.47), "Enterprise-to-equity value bridge.") if chart_b else []
        right = _captioned(_make_image(chart_f, CONTENT_W * 0.47), "Forecast revenue, EBITDA and free cash flow.") if chart_f else []
        if left or right:
            story.append(_two_up(left, right))
            story.append(source_line("APEX valuation and forecast engines."))
            story.append(Spacer(1, 3))

    multiples = (payload.get("market_context") or {}).get("multiples") or {}
    m_rows = multiples.get("rows") or []
    if m_rows:
        story.append(Paragraph("Market multiples", S["subsection"]))
        head = [_th("Metric", "left"), _th("Value")]
        body = []
        for row in m_rows:
            label = str(row.get("label") or "")
            value = row.get("value")
            if "yield" in label.lower() or "growth" in label.lower():
                formatted = _pct(value)
            else:
                formatted = _num(value) + "x"
            body.append([_cell(label, "left"), _cell(formatted, align="right")])
        story.append(_t(head, body, [CONTENT_W * 0.6, CONTENT_W * 0.4]))
        basis = str(multiples.get("basis") or "computed from current price and latest reported fundamentals.")
        story.append(source_line(basis))

    sens = valuation.get("sensitivity") or {}
    grid = sens.get("table") or []
    if grid:
        terminal_label = str(sens.get("terminal_label") or "terminal growth")
        story.append(Paragraph(
            f"Sensitivity — fair value per share (WACC × {_escape(terminal_label)})",
            S["subsection"],
        ))
        story.append(_sensitivity_table(sens, cur, _finite(valuation.get("wacc")), _finite(valuation.get("terminal_growth"))))
        story.append(source_line(
            f"base case WACC {_pct(valuation.get('wacc'))}, {_escape(terminal_label)} {_pct(valuation.get('terminal_growth'))}."
        ))
    reverse = valuation.get("reverse_dcf") or {}
    if reverse.get("implied_wacc") is not None:
        story.append(Paragraph(
            f"Reverse DCF: the current price of {_price(reverse.get('current_price'), cur)} implies a "
            f"{_pct(reverse.get('implied_wacc'))} discount rate"
            + (f" versus the model WACC of {_pct(valuation.get('wacc'))}." if valuation.get("wacc") is not None else "."),
            S["body_sm"],
        ))
    return story


def _dcf_schedule(dcf: dict[str, Any], payload: dict[str, Any]) -> list:
    cur = _currency(payload)
    valuation = payload.get("valuation") or {}
    fcfs = valuation.get("fcf") or []
    wacc = _finite(valuation.get("wacc")) or _finite(dcf.get("wacc"))
    labels = _forecast_labels(payload)[: len(fcfs)]
    out: list = [Paragraph("Discounted cash flow schedule", S["subsection"])]
    if fcfs and wacc is not None:
        head = [_th("Line", "left")] + [_th(l) for l in labels]
        dfs = [1.0 / ((1.0 + wacc) ** (i + 1)) for i in range(len(fcfs))]
        pvs = [(_finite(f) or 0.0) * d for f, d in zip(fcfs, dfs)]
        rows = [
            ("Free cash flow", [_money(f, cur) for f in fcfs]),
            ("Discount factor", [_num(d, 3) for d in dfs]),
            ("Present value", [_money(p, cur) for p in pvs]),
        ]
        body = [[_cell(label, "left")] + [_cell(v, align="right", forecast=True) for v in values] for label, values in rows]
        widths = [CONTENT_W * 0.2] + [(CONTENT_W * 0.8) / max(1, len(labels))] * len(labels)
        out.append(_t(head, body, widths, forecast_from=1))

    terminal_head = [_th("Terminal value line", "left"), _th("Amount"), _th("Present value")]
    terminal_body = [
        [_cell("PV of explicit-period FCF", "left"), _cell(_money(dcf.get("pv_cash_flows"), cur), align="right"),
         _cell(_money(dcf.get("pv_cash_flows"), cur), align="right")],
        [_cell("Terminal value (undiscounted)", "left"), _cell(_money(dcf.get("terminal_value"), cur), align="right"),
         _cell("—", align="right")],
        [_cell("PV of terminal value", "left"), _cell("—", align="right"),
         _cell(_money(dcf.get("pv_terminal_value"), cur), align="right")],
    ]
    out.append(_t(terminal_head, terminal_body, [CONTENT_W * 0.52, CONTENT_W * 0.24, CONTENT_W * 0.24],
                  style_opts=[("BACKGROUND", (0, 1), (-1, -1), colors.white)]))
    terminal_mode = str(valuation.get("terminal_mode") or "growth")
    if terminal_mode == "growth":
        terminal_desc = f"terminal growth {_pct(valuation.get('terminal_growth'))}"
    else:
        terminal_desc = f"exit multiple {_num(valuation.get('exit_multiple'))}x"
    out.append(source_line(
        f"{terminal_desc}; explicit horizon {len(fcfs)} years at WACC {_pct(wacc)}; "
        f"free cash flow before financing. All figures in {cur}."
    ))
    out.append(Spacer(1, 4))
    return out


def _bridge_table(payload: dict[str, Any], dcf: dict[str, Any], cur: str) -> list:
    price = payload.get("price") or {}
    meta = payload.get("meta") or {}
    valuation = payload.get("valuation") or {}
    rating = payload.get("rating") or {}
    net_debt = valuation.get("net_debt") if valuation.get("net_debt") is not None else dcf.get("net_debt")
    equity = dcf.get("equity_value")
    per_share = dcf.get("value_per_share")
    shares = valuation.get("shares") or meta.get("shares") or price.get("shares_outstanding")
    upside = None
    if per_share and price.get("current"):
        upside = per_share / price["current"] - 1
    rows = [
        ("Enterprise value (DCF)", _money(dcf.get("enterprise_value"), cur)),
        ("Less: net debt", _money(net_debt, cur)),
        ("Equity value", _money(equity, cur)),
        ("Shares outstanding", _compact(shares)),
        ("Value per share", _price(per_share, cur)),
        ("Current price", _price(price.get("current"), cur)),
        ("Implied upside", _signed_pct(upside)),
        ("Rating", f"{rating.get('code') or '—'} ({rating.get('horizon') or '12M'})"),
    ]
    head = [_th("Equity bridge", "left"), _th("Value")]
    body = [
        [_cell(label, "left", bold=label in ("Value per share", "Implied upside")), _cell(value, align="right", bold=label in ("Value per share", "Implied upside"))]
        for label, value in rows
    ]
    out = [_t(head, body, [CONTENT_W * 0.6, CONTENT_W * 0.4])]
    out.append(source_line("APEX valuation engine; net debt from the latest balance sheet."))
    return out


def _sensitivity_table(sens: dict[str, Any], cur: str, base_wacc: float | None = None, base_growth: float | None = None) -> Table:
    grid = sens.get("table") or []
    waccs = sens.get("wacc_values") or []
    growths = sens.get("terminal_values") or []
    terminal_label = str(sens.get("terminal_label") or "terminal growth")
    head = [_th(f"WACC \\ {terminal_label}", "left")] + [_th(_pct(g, 1)) for g in growths]
    body = []
    highlights = []
    for row_index, wacc in enumerate(waccs):
        cells = [_cell(_pct(wacc, 1), "left", bold=(base_wacc is not None and abs(wacc - base_wacc) < 1e-9))]
        for col_index, value in enumerate(grid[row_index]):
            is_base = (
                base_wacc is not None and base_growth is not None
                and abs(wacc - base_wacc) < 1e-9 and abs(growths[col_index] - base_growth) < 1e-9
            )
            if is_base:
                highlights.append(("BACKGROUND", (col_index + 1, row_index + 1), (col_index + 1, row_index + 1), FORECAST_TINT))
            cells.append(_cell(_price(value, cur), align="right", bold=is_base))
        body.append(cells)
    widths = [CONTENT_W * 0.2] + [(CONTENT_W * 0.8) / max(1, len(growths))] * len(growths)
    return _t(head, body, widths, style_opts=highlights)


def _forecast_section(payload: dict[str, Any], quick: bool = False) -> list:
    forecast = payload.get("forecast") or {}
    periods = forecast.get("periods") or []
    assumptions = forecast.get("assumptions") or {}
    if not periods:
        return []
    cur = _currency(payload)
    labels = _forecast_labels(payload)[: len(periods)]
    story = section(
        "Forecast drivers and assumptions",
        subtitle="The operating assumptions behind every projected line; they drive, never reverse-engineer, the valuation.",
        eyebrow="Forecast",
    )

    values_map = assumptions.get("values") or assumptions if isinstance(assumptions, dict) else {}
    if isinstance(values_map, dict) and values_map:
        provenance_map = (assumptions.get("provenance") or {}) if isinstance(assumptions, dict) else {}
        story.append(Paragraph("Key assumptions", S["subsection"]))
        head = [_th("Assumption", "left"), _th("Value"), _th("Basis", "left")]
        body = []
        for key, value in values_map.items():
            label = str(key).replace("_", " ").capitalize()
            if isinstance(value, (list, tuple)):
                formatted = "per-year schedule" if len(value) > 1 else (_pct(value[0]) if abs(value[0]) <= 1 else _money(value[0], cur))
            elif isinstance(value, bool):
                formatted = "yes" if value else "no"
            elif isinstance(value, str):
                formatted = value
            elif any(t in key for t in ("rate", "margin", "payout", "growth", "sweep", "dilution", "erp", "spread", "pct", "ratio")):
                formatted = _pct(value)
            elif any(t in key for t in ("cash", "debt", "revenue", "ebitda", "equity", "capex", "assets", "multiple", "shares", "nwc", "ppe", "liabilities")):
                formatted = _money(value, cur) if "shares" not in key else _compact(value)
            else:
                formatted = _num(value)
            provenance = str(provenance_map.get(key) or "")
            basis = "analyst override" if "override" in provenance else "engine base year"
            body.append([_cell(label, "left"), _cell(formatted, align="right"), _cell(basis, "left", muted=True)])
        story.append(_t(head, body, [CONTENT_W * 0.44, CONTENT_W * 0.28, CONTENT_W * 0.28]))
        story.append(source_line("base-year values from reported statements; forward paths from the forecast engine."))

    story.append(CondPageBreak(240))
    story.append(Paragraph("Forecast summary", S["subsection"]))
    head = [_th("Line", "left")] + [_th(label) for label in labels]
    rows = [
        ("Revenue", [_money(p.get("revenue"), cur) for p in periods]),
        ("Revenue growth", [_pct(p.get("revenue_growth")) for p in periods]),
        ("EBITDA", [_money(p.get("ebitda"), cur) for p in periods]),
        ("EBITDA margin", [_pct(p.get("ebitda_margin")) for p in periods]),
        ("EBIT margin", [_pct(p.get("ebit_margin")) for p in periods]),
        ("Net income", [_money(p.get("net_income"), cur) for p in periods]),
        ("Diluted EPS", [_num(p.get("eps")) for p in periods]),
        ("Operating cash flow", [_money(p.get("ocf"), cur) for p in periods]),
        ("CapEx", [_money(p.get("capex"), cur) for p in periods]),
        ("Free cash flow", [_money(p.get("fcf"), cur) for p in periods]),
        ("Cash balance", [_money(p.get("cash"), cur) for p in periods]),
        ("Debt", [_money(p.get("debt"), cur) for p in periods]),
        ("Dividends paid", [_money(p.get("dividends"), cur) for p in periods]),
    ]
    body = [[_cell(label, "left", bold=label in ("Revenue", "Free cash flow"))] +
            [_cell(v, align="right", forecast=True) for v in values] for label, values in rows]
    widths = [CONTENT_W * 0.2] + [(CONTENT_W * 0.8) / len(labels)] * len(labels)
    story.append(_t(head, body, widths, forecast_from=1))
    story.append(source_line("APEX forecast engine; forecast columns are estimates, not company guidance."))
    return story


def _appendix_section(payload: dict[str, Any], quick: bool = False) -> list:
    historical = payload.get("historical", {})
    story = section(
        "Appendix — reported statements",
        subtitle="Figures as reported; margins and growth are computed on top.",
        eyebrow="Appendix",
    )
    metrics = historical.get("metrics") or []
    if not metrics:
        story.append(Paragraph("No reported statements available.", S["body_muted"]))
        return story

    income_rows = [
        ("Revenue", lambda m: _money(m.get("revenue"), _currency(payload))),
        ("Revenue growth", lambda m: _pct(m.get("revenue_growth"))),
        ("Gross profit", lambda m: _money(m.get("gross_profit"), _currency(payload))),
        ("EBITDA", lambda m: _money(m.get("ebitda"), _currency(payload))),
        ("EBITDA margin", lambda m: _pct(m.get("ebitda_margin"))),
        ("EBIT", lambda m: _money(m.get("ebit"), _currency(payload))),
        ("Operating margin", lambda m: _pct(m.get("operating_margin"))),
        ("Net income", lambda m: _money(m.get("net_income"), _currency(payload))),
        ("Net margin", lambda m: _pct(m.get("net_margin"))),
        ("Diluted EPS", lambda m: _num(m.get("eps_diluted"))),
        ("Effective tax rate", lambda m: _pct(m.get("tax_rate"))),
        ("Interest coverage", lambda m: _num(m.get("interest_coverage"))),
    ]
    story += _statement_block(f"Income statement — FY basis ({len(metrics)} periods)", income_rows, metrics)

    balance_rows = [
        ("Cash &amp; equivalents", lambda m: _money(m.get("cash"), _currency(payload))),
        ("Total assets", lambda m: _money(m.get("total_assets"), _currency(payload))),
        ("Total debt", lambda m: _money(m.get("total_debt"), _currency(payload))),
        ("Net debt", lambda m: _money(m.get("net_debt"), _currency(payload))),
        ("Shareholders' equity", lambda m: _money(m.get("equity"), _currency(payload))),
        ("Book value / share", lambda m: _num(m.get("book_value_per_share"))),
        ("Current ratio", lambda m: _num(m.get("current_ratio"))),
        ("Quick ratio", lambda m: _num(m.get("quick_ratio"))),
        ("Debt / equity", lambda m: _num(m.get("debt_to_equity"))),
    ]
    story += _statement_block("Balance sheet", balance_rows, metrics)

    cash_rows = [
        ("Operating cash flow", lambda m: _money(m.get("ocf"), _currency(payload))),
        ("CapEx", lambda m: _money(m.get("capex"), _currency(payload))),
        ("Free cash flow", lambda m: _money(m.get("fcf"), _currency(payload))),
        ("FCF margin", lambda m: _pct(m.get("fcf_margin"))),
        ("Capex intensity", lambda m: _pct(m.get("capex_intensity"))),
        ("Cash conversion", lambda m: _num(m.get("cash_conversion"))),
    ]
    story += _statement_block("Cash flow", cash_rows, metrics)

    quarters = historical.get("quarterly_metrics") or []
    if quarters and not quick:
        story.append(Paragraph("Quarterly income statement", S["subsection"]))
        q_metrics = quarters[::-1]
        q_labels = (historical.get("quarterly_periods") or [])[::-1]
        q_rows = [
            ("Revenue", lambda m: _money(m.get("revenue"), _currency(payload))),
            ("Gross profit", lambda m: _money(m.get("gross_profit"), _currency(payload))),
            ("EBITDA", lambda m: _money(m.get("ebitda"), _currency(payload))),
            ("Net income", lambda m: _money(m.get("net_income"), _currency(payload))),
            ("Diluted EPS", lambda m: _num(m.get("eps_diluted"))),
        ]
        story += _render_statement(q_rows, q_metrics, q_labels)
        story.append(source_line("quarterly statements from the data source."))
    return story


def _statement_block(title: str, rows_spec: list, metrics: list[dict], labels: list[str] | None = None) -> list:
    out = [Paragraph(title, S["subsection"])]
    if labels is None:
        labels = [str(m.get("period_end") or "")[:4] for m in metrics]
    out += _render_statement(rows_spec, metrics, labels)
    return out


def _render_statement(rows_spec: list, metrics: list[dict], labels: list[str]) -> list:
    head = [_th("Line", "left")] + [_th(label) for label in labels]
    body = []
    for label, formatter in rows_spec:
        values = []
        for metric in metrics:
            try:
                values.append(formatter(metric))
            except Exception:
                values.append("—")
        if all(v == "—" for v in values):
            continue
        clean = label.replace("&amp;", "&")
        body.append([_cell(clean, "left", bold=clean in ("Revenue", "Net income", "Free cash flow"))] +
                    [_cell(v, align="right") for v in values])
    widths = [CONTENT_W * 0.22] + [(CONTENT_W * 0.78) / max(1, len(labels))] * len(labels)
    return [_t(head, body, widths), source_line("computed by APEX from reported statements; blank lines render as em-dash.")]


def _conclusion_section(payload: dict[str, Any], cfg: dict[str, Any]) -> list:
    story = section(
        "Investment conclusion",
        subtitle="How the fundamentals, trajectory, valuation and risks reconcile into the published view.",
        eyebrow="Conclusion",
    )
    narrative = payload.get("narrative") or {}
    rating = payload.get("rating") or {}
    cur = _currency(payload)
    code = str(rating.get("code") or "NOT RATED")

    summary = str(narrative.get("conclusion") or "").strip()
    if not summary:
        bits = []
        if rating.get("target_price") and (payload.get("price") or {}).get("current"):
            bits.append(
                f"{code} with a {_horizon_word(rating)} fair value of {_price(rating.get('target_price'), cur)} "
                f"versus the last close of {_price((payload.get('price') or {}).get('current'), cur)} "
                f"({_signed_pct(rating.get('upside'))})."
            )
        first_bullet = (_deterministic_thesis(payload, cfg) or [""])[0]
        if first_bullet:
            bits.append(first_bullet)
        summary = " ".join(bits) or "Insufficient evidence for a rated conclusion; see data gaps."
    story.append(Paragraph(_escape(summary[:1600]), S["body"]))

    balanced = str(narrative.get("balanced_view") or "").strip()
    if balanced:
        story.append(Paragraph("Balanced view", S["subsection"]))
        story.append(Paragraph(_escape(balanced[:900]), S["body_sm"]))

    change_view = _arr(narrative.get("what_would_change_the_view"))
    if change_view:
        story.append(Paragraph("What would change the view", S["subsection"]))
        for item in change_view[:5]:
            story.append(Paragraph(_escape(item), S["bullet_sm"], bulletText="•"))

    if code in (None, "NOT RATED"):
        story.append(Paragraph(
            "This report is Not Rated: the available evidence does not support a defensible target price "
            "over the stated horizon.",
            S["body_muted"],
        ))
    story.append(_ai_tag(payload) or Spacer(1, 0))
    return story


def _horizon_word(rating: dict[str, Any]) -> str:
    return f"{str(rating.get('horizon') or '12M')}"


def _risk_section(payload: dict[str, Any], quick: bool = False) -> list:
    narrative = payload.get("narrative") or {}
    story = section(
        "Risks and monitoring",
        subtitle="What could invalidate the thesis and what to watch each quarter.",
        eyebrow="Risk",
    )
    risks = _arr(narrative.get("key_risks") or narrative.get("bear_case")) or _risks_cover(payload)
    story.append(Paragraph("Principal risks", S["subsection"]))
    for risk in risks[:6]:
        story.append(Paragraph(_escape(risk), S["bullet"], bulletText="•"))
    story.append(Spacer(1, 3))
    story.append(Paragraph("Monitoring points", S["subsection"]))
    for point in _arr(narrative.get("key_questions")) or _catalysts_cover(payload)[:4]:
        story.append(Paragraph(_escape(point), S["bullet"], bulletText="•"))
    return story


def _sources_section(payload: dict[str, Any]) -> list:
    story = section(
        "Sources, provenance and methodology",
        subtitle="Every figure in this report traces to one of the sources below.",
        eyebrow="Provenance",
    )
    sources = payload.get("sources") or []
    if sources:
        head = [_th("ID", "left"), _th("Source", "left"), _th("Detail", "left"), _th("Retrieved", "left")]
        body = [[_cell(str(s.get("ref") or s.get("id") or ""), "left"), _cell(str(s.get("label") or s.get("source") or ""), "left"),
                 _cell(str(s.get("where") or s.get("detail") or ""), "left", muted=True),
                 _cell(str(s.get("retrieved_at") or "—"), "left", muted=True)] for s in sources]
        story.append(_t(head, body, [CONTENT_W * 0.08, CONTENT_W * 0.3, CONTENT_W * 0.44, CONTENT_W * 0.18]))
    documents = payload.get("source_documents") or []
    if documents:
        story.append(Paragraph("Documents reviewed", S["subsection"]))
        head = [_th("Document", "left"), _th("Type", "left"), _th("Date", "left"), _th("Reference", "left")]
        body = [[_cell(str(d.get("title") or "—"), "left"), _cell(str(d.get("type") or "—"), "left"),
                 _cell(str(d.get("date") or "—"), "left"), _cell(str(d.get("url") or d.get("reference") or "—"), "left", muted=True)]
                for d in documents[:12]]
        story.append(_t(head, body, [CONTENT_W * 0.36, CONTENT_W * 0.16, CONTENT_W * 0.14, CONTENT_W * 0.34]))
        story.append(source_line("documents supplied with the research request; references are not independently verified."))
    story.append(Spacer(1, 3))
    story.append(Paragraph("Methodology", S["subsection"]))
    for item in _methodology_bullets(payload):
        story.append(Paragraph(_escape(item), S["bullet_sm"], bulletText="•"))
    narrative = _ai_tag(payload)
    if narrative:
        story.append(Spacer(1, 2))
        story.append(narrative)
    return story


def _methodology_bullets(payload: dict[str, Any]) -> list[str]:
    return [
        "Actuals: reported financial statements from the named data source, normalised into a common schema.",
        "Forecast: driver-based model (revenue growth → margins → tax → capex/depreciation → working capital → FCF).",
        "Valuation: WACC-discounted explicit-period FCF plus a terminal value; equity bridge deducts net debt and divides by diluted shares.",
        "Rating: fair value versus the last close, banded at +15% (BUY), −5%…+15% (HOLD), below −5% (SELL) over the stated horizon.",
        "Missing data renders as an em-dash and is never substituted with zero or with an AI-estimated figure.",
    ]


def _gaps_qc_section(payload: dict[str, Any], quick: bool = False) -> list:
    qc_raw = payload.get("qc") or []
    qc_items = qc_raw if isinstance(qc_raw, list) else list((qc_raw or {}).get("issues") or [])
    errors = [q for q in qc_items if isinstance(q, dict) and q.get("level") == "error"]
    warnings = [q for q in qc_items if isinstance(q, dict) and q.get("level") == "warning"]
    infos = [q for q in qc_items if isinstance(q, dict) and q.get("level") == "info"]
    story = section(
        "Data gaps and quality control",
        subtitle="Known limitations of this report's inputs.",
        eyebrow="QC",
    )
    if not qc_items:
        story.append(Paragraph("Automated payload QC reported no warnings or issues.", S["body_muted"]))
    for group, title in ((errors, "Issues (failures)"), (warnings, "Warnings"), (infos, "Notes")):
        if not group:
            continue
        story.append(Paragraph(title, S["subsection"]))
        for item in group[:8]:
            text = str(item.get("detail") or item.get("check") or "")
            story.append(Paragraph(_escape(text), S["bullet_sm"], bulletText="•"))
    gaps = payload.get("gaps") or []
    if gaps:
        story.append(Paragraph("Data gaps", S["subsection"]))
        for gap in gaps[:8]:
            area = str(gap.get("area") or "gap")
            detail = str(gap.get("detail") or "")
            story.append(Paragraph(_escape(f"{area}: {detail}"), S["bullet_sm"], bulletText="•"))
    quality = payload.get("data_quality") or {}
    alerts = quality.get("alerts") or []
    if alerts:
        story.append(Paragraph("Data-quality alerts", S["subsection"]))
        for alert in alerts[:6]:
            message = str(alert.get("message") or alert)
            story.append(Paragraph(_escape(message), S["bullet_sm"], bulletText="•"))
    narrative = payload.get("narrative") or {}
    limitations = _arr(narrative.get("limitations"))
    if limitations:
        story.append(Paragraph("Stated limitations", S["subsection"]))
        for limitation in limitations[:6]:
            story.append(Paragraph(_escape(limitation), S["bullet_sm"], bulletText="•"))
    else:
        story.append(Paragraph(
            "Limitations: figures depend on the data source's completeness and timing; peer and macro series may be "
            "unavailable; forecasts are model outputs, not guidance.",
            S["body_sm"],
        ))
    return story


DISCLOSURE_PARAGRAPHS = [
    "This document has been prepared by APEX Research for informational purposes only and does not constitute an "
    "offer or solicitation to buy or sell any security. Opinions and estimates are those of APEX Research as of the "
    "publication date and are subject to change without notice.",
    "APEX Research and its affiliates may hold long or short positions in, act as market maker for, or provide "
    "investment-banking services to the companies covered. Compensation may be tied to specific activities.",
    "Recipients should not rely on this document as the sole basis for any investment decision and should consider "
    "their own circumstances, objectives and risk tolerance. Past performance is not indicative of future results.",
    "The valuation methodology, scenario analysis and forecasts are model outputs built from the data sources listed "
    "in this document; they are estimates, not guarantees. Figures shown as em-dashes indicate data that was not "
    "available and has not been estimated.",
]


def _dynamic_disclosures(payload: dict[str, Any]) -> list[str]:
    """Provider, retrieval, demo, AI-model and limitation disclosures from the payload."""
    out: list[str] = []
    sources = payload.get("sources") or []
    if sources:
        labels = "; ".join(str(s.get("label") or s.get("ref") or "") for s in sources[:4] if isinstance(s, dict))
        retrieved = next((str(s.get("retrieved_at") or "") for s in sources if isinstance(s, dict) and s.get("retrieved_at")), "")
        out.append(
            f"Data providers and retrieval: {labels or 'listed in the sources section'}"
            + (f"; retrieved {retrieved[:19]}." if retrieved else ".")
        )
    quality = payload.get("data_quality") or {}
    alerts = quality.get("alerts") or []
    demo = bool(quality.get("demo") or (payload.get("meta") or {}).get("demo"))
    if demo:
        out.append(
            "This report is generated from a synthetic demonstration fixture. All company figures, prices and "
            "market data are fabricated for evaluation purposes and do not represent any real issuer or security."
        )
    if quality.get("stale"):
        out.append("Some input data is flagged stale by the data source; figures may not reflect the latest reporting period.")
    ai_model = payload.get("narrative_model")
    if ai_model:
        out.append(
            f"Qualitative narrative sections were drafted with AI assistance (model: {ai_model}) and reviewed only by "
            "automated validation; every quantitative figure originates from the deterministic calculation engines."
        )
    else:
        out.append("This report is fully deterministic: no AI-generated narrative is included; all qualitative text is rule-based.")
    gaps = payload.get("gaps") or []
    if gaps:
        out.append(
            "Known data limitations: "
            + "; ".join(f"{str(g.get('area') or 'area')}: {str(g.get('detail') or '')}" for g in gaps[:3])
            + "."
        )
    out.append(
        "This document is a model-generated research note that has not been independently verified, peer-reviewed "
        "or produced under a regulated research process; it is not regulated investment advice."
    )
    return out


def _disclosures_section(payload: dict[str, Any]) -> list:
    story = section(
        "Disclosures",
        subtitle="Certification, providers, AI usage, demo-data status and general disclosures.",
        eyebrow="Legal",
    )
    for paragraph in _dynamic_disclosures(payload) + DISCLOSURE_PARAGRAPHS:
        story.append(Paragraph(_escape(paragraph), S["disclaimer"]))
        story.append(Spacer(1, 3))
    return story


# --------------------------------------------------------------------------- #
# assembly
# --------------------------------------------------------------------------- #

def build_research_pdf(payload: dict[str, Any], cfg: dict[str, Any] | None = None, quick: bool | None = None) -> bytes:
    cfg = dict(cfg or {})
    if quick is None:
        quick = str(cfg.get("report_type") or "full").lower() == "quick"
    _reset_counters()
    ticker = str(payload.get("ticker") or "RESEARCH").upper()
    meta = payload.get("meta") or {}
    name = str(meta.get("name") or ticker)
    report_date = str(cfg.get("report_date") or payload.get("report_date") or datetime.now(timezone.utc).date().isoformat())[:10]
    report_title = str(cfg.get("report_title") or "").strip()

    buffer = io.BytesIO()
    footer = f"APEX Research · {ticker} · {report_date} · educational model output, not investment advice"
    header = f"{name} ({ticker}) · {report_title or 'Equity research'}"

    doc = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=FRAME_TOP,
        bottomMargin=FRAME_BOTTOM,
        title=f"APEX Research — {name} ({ticker})" + (f" — {report_title}" if report_title else ""),
        author="APEX Research",
        subject="Institutional-style equity research",
    )
    frame = Frame(MARGIN, FRAME_BOTTOM, CONTENT_W, PAGE_H - FRAME_TOP - FRAME_BOTTOM, id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame])])

    story: list = cover(payload, cfg, quick=quick)

    if not quick:
        story += _toc_section()
        story += _executive_summary(payload, cfg)
    story += _thesis_section(payload, cfg)
    if not quick:
        story += _company_section(payload)
    story += _financial_section(payload, quick=quick)
    if not quick:
        story += _operating_section(payload, quick=quick)
    story += _valuation_section(payload, quick=quick)
    story += _forecast_section(payload, quick=quick)
    if not quick:
        story += _appendix_section(payload, quick=quick)
    story += _conclusion_section(payload, cfg)
    story += _risk_section(payload, quick=quick)
    story += _sources_section(payload)
    story += _gaps_qc_section(payload, quick=quick)
    story += _disclosures_section(payload)

    doc.build(story, canvasmaker=canvasmaker(footer, header))
    return buffer.getvalue()
