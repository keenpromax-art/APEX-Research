import React from "react";
import { Text, View } from "@react-pdf/renderer";
import { pdfStyles as S, COLORS } from "./pdfStyles";
import type { PresentationViewModel } from "@/lib/report-plan/presentation";
import type { ReportData } from "@/types/report";

export function presentationForData(data: ReportData): PresentationViewModel | null {
  const record = data as unknown as Record<string, unknown>;
  const direct = record.presentationViewModel as PresentationViewModel | undefined;
  if (direct && typeof direct === "object" && typeof direct.viewHash === "string") return direct;
  const composed = (data as unknown as { composedReport?: { presentation?: PresentationViewModel } }).composedReport;
  if (composed?.presentation && typeof composed.presentation.viewHash === "string") return composed.presentation;
  const nested = record.reportPresentation as PresentationViewModel | undefined;
  if (nested && typeof nested === "object" && typeof nested.viewHash === "string") return nested;
  return null;
}

export function hasCanonicalPresentation(data: ReportData): boolean {
  return presentationForData(data) !== null;
}

function MetricRow({ label, display, state, provenance }: { label: string; display: string; state: string; provenance: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
      <Text style={{ fontSize: 7, color: COLORS.slateDark }}>{label}</Text>
      <Text style={{ fontSize: 7 }}>{`${display} · ${state} · ${provenance}`}</Text>
    </View>
  );
}

export function CanonicalPresentationCover({ view, companyName, reportTitle }: { view: PresentationViewModel; companyName: string; reportTitle: string }) {
  return (
    <View style={S.contentArea}>
      <Text style={S.footnote}>{`${reportTitle} · Plan ${view.planHash.slice(0, 12)} · View ${view.viewHash.slice(0, 12)}`}</Text>
      <Text style={S.sectionTitle}>{companyName}</Text>
      {view.metrics.map((metric) => (
        <MetricRow key={metric.key} label={metric.label} display={metric.display} state={metric.state} provenance={metric.provenance} />
      ))}
      {view.disclosures.map((text, index) => (
        <Text key={index} style={S.footnote}>{text}</Text>
      ))}
    </View>
  );
}

export function CanonicalPresentationStatements({ view }: { view: PresentationViewModel }) {
  if (view.statements.length === 0) {
    return (
      <View style={S.contentArea}>
        <Text style={S.sectionTitle}>Statements</Text>
        <Text style={S.bodyText}>Unavailable — no canonical history was supplied.</Text>
      </View>
    );
  }
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Precomputed Statements</Text>
      {view.statements.map((statement) => (
        <View key={statement.id}>
          <Text style={S.subsectionTitle}>{`${statement.title} (${statement.units})`}</Text>
          {statement.rows.map((row) => (
            <View key={row.label}>
              <Text style={S.bodyText}>{row.label}</Text>
              {row.cells.map((cell, index) => (
                <Text key={index} style={S.footnote}>{`${statement.columns[index] ?? cell.period}: ${cell.display} · ${cell.state}`}</Text>
              ))}
            </View>
          ))}
          {statement.state === "unavailable" ? <Text style={S.bodyText}>Unavailable — canonical series missing.</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function CanonicalPresentationSensitivity({ view }: { view: PresentationViewModel }) {
  if (view.sensitivity.state === "unavailable") {
    return (
      <View style={S.contentArea}>
        <Text style={S.sectionTitle}>Sensitivity</Text>
        <Text style={S.bodyText}>Unavailable — {view.sensitivity.note}</Text>
      </View>
    );
  }
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Precomputed Sensitivity</Text>
      <Text style={S.footnote}>{view.sensitivity.note}</Text>
      {view.sensitivity.rows.map((row, index) => (
        <Text key={index} style={S.footnote}>{`${row.label}: ${row.values.map((cell) => cell.display).join(" | ")}`}</Text>
      ))}
    </View>
  );
}

export function CanonicalPresentationEvents({ view }: { view: PresentationViewModel }) {
  if (view.events.length === 0) {
    return (
      <View style={S.contentArea}>
        <Text style={S.sectionTitle}>Events</Text>
        <Text style={S.bodyText}>Unavailable — no measured event price movements are available.</Text>
      </View>
    );
  }
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Measured Events Only</Text>
      {view.events.map((event) => (
        <View key={event.id}>
          <Text style={S.subsectionTitle}>{event.headline}</Text>
          {event.measured ? (
            <Text style={S.footnote}>{`MEASURED · ${event.eventDate} · immediate ${event.immediateReturnPct ?? "Unavailable"} · multi-day ${event.multiDayReturnPct ?? "Unavailable"}`}</Text>
          ) : (
            <Text style={S.footnote}>Illustrative event — not factual. No chart.</Text>
          )}
        </View>
      ))}
    </View>
  );
}

export function CanonicalPresentationCharts({ view }: { view: PresentationViewModel }) {
  const rendered = view.charts.filter((chart) => chart.omissionReason === null);
  const omitted = view.charts.filter((chart) => chart.omissionReason !== null);
  if (rendered.length === 0 && omitted.length === 0) {
    return (
      <View style={S.contentArea}>
        <Text style={S.sectionTitle}>Charts</Text>
        <Text style={S.bodyText}>Unavailable — no chart specifications are available.</Text>
      </View>
    );
  }
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Precomputed Charts</Text>
      {rendered.map((chart) => (
        <View key={chart.id}>
          <Text style={S.subsectionTitle}>{chart.title}</Text>
          {chart.provenance === "illustrative" ? (
            <Text style={S.footnote}>Illustrative visual — not factual.</Text>
          ) : (
            <Text style={S.footnote}>{`${chart.periods.length} periods · ${chart.units} · ${chart.provenance} · ${chart.hash.slice(0, 12)}`}</Text>
          )}
          {chart.series.slice(0, 12).map((point, index) => (
            <Text key={index} style={S.footnote}>{`${point.period}: ${point.display} · ${point.state}`}</Text>
          ))}
        </View>
      ))}
      {omitted.map((chart) => (
        <Text key={chart.id} style={S.footnote}>{`${chart.id} omitted — ${chart.omissionReason}`}</Text>
      ))}
      {view.visualLabels.map((label, index) => (
        <Text key={`label-${index}`} style={S.footnote}>{label}</Text>
      ))}
    </View>
  );
}

export function CanonicalPresentationTables({ view }: { view: PresentationViewModel }) {
  const rendered = view.tables.filter((table) => table.omissionReason === null);
  const omitted = view.tables.filter((table) => table.omissionReason !== null);
  if (rendered.length === 0 && omitted.length === 0) {
    return (
      <View style={S.contentArea}>
        <Text style={S.sectionTitle}>Tables</Text>
        <Text style={S.bodyText}>Unavailable — no table specifications are available.</Text>
      </View>
    );
  }
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Precomputed Tables</Text>
      {rendered.map((table) => (
        <View key={table.id}>
          <Text style={S.subsectionTitle}>{table.title}</Text>
          <Text style={S.footnote}>{`${table.columns.join(" | ")} · ${table.units} · ${table.provenance} · ${table.hash.slice(0, 12)}`}</Text>
          {table.rows.slice(0, 12).map((row, index) => (
            <Text key={index} style={S.footnote}>{`${row.label}: ${row.cells.map((cell) => cell.display).join(" | ")}`}</Text>
          ))}
        </View>
      ))}
      {omitted.map((table) => (
        <Text key={table.id} style={S.footnote}>{`${table.id} omitted — ${table.omissionReason}`}</Text>
      ))}
    </View>
  );
}
