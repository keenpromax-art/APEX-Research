from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from typing import Any
from xml.sax.saxutils import escape

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/export", tags=["export"])


def _filename(body: dict[str, Any], extension: str) -> str:
    ticker = str(body.get("ticker") or "model").upper()
    safe = re.sub(r"[^A-Z0-9._-]+", "_", ticker).strip("._") or "model"
    return f"apex_{safe}_{extension}"


def _scalar(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


@router.post("/xlsx")
def export_xlsx(body: dict[str, Any]):
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Excel export unavailable: {error}")

    workbook = openpyxl.Workbook()
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1F2937")
    bold = Font(bold=True)

    def style_header(sheet, row: int = 1) -> None:
        for cell in sheet[row]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

    def autosize(sheet) -> None:
        for column in sheet.columns:
            length = max((len(str(cell.value)) if cell.value is not None else 0) for cell in column)
            sheet.column_dimensions[get_column_letter(column[0].column)].width = min(max(length + 2, 10), 48)

    forecast = body.get("forecast") or {}
    periods = forecast.get("periods") or []
    sheet = workbook.active
    sheet.title = "Forecast"
    if periods:
        lines = [
            "revenue",
            "gross_profit",
            "ebitda",
            "ebit",
            "net_income",
            "ocf",
            "fcf",
            "capex",
            "cash",
            "debt",
            "equity",
            "eps",
            "balance_check",
        ]
        sheet.append(["Line item"] + [f"Y{period.get('year', index + 1)}" for index, period in enumerate(periods)])
        for line in lines:
            sheet.append([line.replace("_", " ").title()] + [period.get(line) for period in periods])
        style_header(sheet)
        sheet.freeze_panes = "B2"
        autosize(sheet)
    else:
        sheet.append(["No forecast supplied"])
        autosize(sheet)

    assumptions = forecast.get("assumptions") or body.get("assumptions") or {}
    if assumptions:
        sheet = workbook.create_sheet("Assumptions")
        sheet.append(["Assumption", "Value"])
        for key, value in assumptions.items():
            sheet.append([key.replace("_", " ").title(), _scalar(value)])
        style_header(sheet)
        autosize(sheet)

    dcf_result = body.get("dcf") or {}
    if dcf_result:
        sheet = workbook.create_sheet("DCF")
        sheet.append(["Metric", "Value"])
        for key, value in dcf_result.items():
            if key == "warnings":
                value = "; ".join(str(item) for item in value) if value else ""
            sheet.append([key.replace("_", " ").title(), _scalar(value)])
        style_header(sheet)
        autosize(sheet)

    sensitivity = body.get("sensitivity") or {}
    if sensitivity and sensitivity.get("table"):
        sheet = workbook.create_sheet("Sensitivity")
        terminal = sensitivity.get("terminal_values") or []
        sheet.append(["WACC \\ Terminal"] + [value for value in terminal])
        for row_index, wacc_value in enumerate(sensitivity.get("wacc_values") or []):
            values = sensitivity["table"][row_index] if row_index < len(sensitivity["table"]) else []
            sheet.append([wacc_value] + list(values))
        style_header(sheet)
        autosize(sheet)

    report = body.get("report") or {}
    if report:
        sheet = workbook.create_sheet("Report")
        sheet.append(["Section", "Content"])
        for key, value in report.items():
            if isinstance(value, (list, tuple)):
                rendered = "\n".join(f"- {item}" for item in value)
            elif isinstance(value, dict):
                rendered = str(value)
            else:
                rendered = str(value)
            sheet.append([key.replace("_", " ").title(), rendered])
            sheet.cell(row=sheet.max_row, column=2).alignment = Alignment(wrap_text=True, vertical="top")
        style_header(sheet)
        sheet.column_dimensions["A"].width = 26
        sheet.column_dimensions["B"].width = 100

    quality = body.get("data_quality") or {}
    sheet = workbook.create_sheet("Sources")
    sheet.append(["APEX Terminal export"])
    sheet.append(["Generated", datetime.now(timezone.utc).isoformat(timespec="seconds")])
    sheet.append(["Ticker", str(body.get("ticker") or "")])
    sheet.append(["Data source", "Yahoo Finance via yfinance"])
    for alert in quality.get("alerts") or []:
        sheet.append([str(alert.get("level", "info")).title(), str(alert.get("message", ""))])
    sheet["A1"].font = bold
    autosize(sheet)

    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{_filename(body, "model.xlsx")}"'},
    )


@router.post("/pdf")
def export_pdf(body: dict[str, Any]):
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"PDF export unavailable: {error}")

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title=str(body.get("title") or "APEX Terminal Research Report"),
    )
    styles = getSampleStyleSheet()
    story: list[Any] = []

    title = str(body.get("title") or "APEX Terminal Research Report")
    story.append(Paragraph(escape(title), styles["Title"]))
    meta = f"Ticker: {escape(str(body.get('ticker') or '—'))} &nbsp;&nbsp; Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    story.append(Paragraph(meta, styles["Normal"]))
    story.append(Spacer(1, 14))

    report = body.get("report") or {}
    if isinstance(report, dict) and report:
        for section, content in report.items():
            story.append(Paragraph(escape(str(section).replace("_", " ").title()), styles["Heading2"]))
            if isinstance(content, (list, tuple)):
                for item in content:
                    story.append(Paragraph(f"• {escape(str(item))}", styles["BodyText"]))
            elif isinstance(content, dict):
                for key, value in content.items():
                    story.append(Paragraph(f"<b>{escape(str(key))}</b>: {escape(str(value))}", styles["BodyText"]))
            else:
                story.append(Paragraph(escape(str(content)), styles["BodyText"]))
            story.append(Spacer(1, 8))

    dcf_result = body.get("dcf") or {}
    if dcf_result:
        story.append(Paragraph("DCF Summary", styles["Heading2"]))
        rows = [["Metric", "Value"]]
        for key, value in dcf_result.items():
            if key == "warnings":
                continue
            if isinstance(value, float):
                value = f"{value:,.2f}"
            rows.append([str(key).replace("_", " ").title(), str(value)])
        table = Table(rows, colWidths=[3.2 * inch, 2.6 * inch])
        table.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 12))

    forecast = body.get("forecast") or {}
    periods = forecast.get("periods") or []
    if periods:
        story.append(Paragraph("Forecast Summary", styles["Heading2"]))
        selected = ["revenue", "ebitda", "net_income", "fcf"]
        rows = [["Line"] + [f"Y{period.get('year', i + 1)}" for i, period in enumerate(periods)]]
        for line in selected:
            rows.append(
                [line.replace("_", " ").title()]
                + [f"{period.get(line):,.0f}" if isinstance(period.get(line), (int, float)) else "—" for period in periods]
            )
        table = Table(rows)
        table.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 12))

    story.append(Paragraph("Sources & Limitations", styles["Heading2"]))
    story.append(
        Paragraph(
            escape(
                "Data: Yahoo Finance via yfinance. Forecasts are deterministic outputs of the APEX driver model. "
                "AI text is assistive only and never supplies final figures. Missing data is shown as a dash, not zero. "
                "This document is not investment advice."
            ),
            styles["BodyText"],
        )
    )

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.grey)
        canvas.drawString(0.75 * inch, 0.45 * inch, "APEX Terminal")
        canvas.drawRightString(letter[0] - 0.75 * inch, 0.45 * inch, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_filename(body, "report.pdf")}"'},
    )
