import React from "react";
import { Text, View } from "@react-pdf/renderer";
import { pdfStyles as S } from "./pdfStyles";
import type { ResearchDNA } from "@/lib/research-identity";

/**
 * Reusable adaptive render primitives (presentation-only).
 * Every block renders deterministic ResearchDNA content; none compute
 * financials, none invent numbers, and all mark unavailable data explicitly.
 */

export function IdentityOverviewBlock({ identity }: { identity: ResearchDNA }) {
  const q = identity.investorQuestion;
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Central Investor Question</Text>
      <Text style={S.bodyText}>
        {q.question ?? "Central investor question: insufficient evidence — explicitly unavailable."}
      </Text>
      <Text style={S.footnote}>
        {`Economic identity: ${identity.economicIdentity.type} · Question type: ${q.type} · Status: ${q.status}`}
      </Text>
      <Text style={S.footnote}>
        {`Valuation lens: ${identity.valuationIdentity.type} · Narrative: ${identity.narrativeProfile.archetype} · Visual: ${identity.visualProfile.archetype}`}
      </Text>
    </View>
  );
}

export function SignatureAnalysisBlock({ identity }: { identity: ResearchDNA }) {
  if (identity.signatureAnalyses.length === 0) {
    return (
      <View style={S.contentArea}>
        <Text style={S.sectionTitle}>Signature Analysis</Text>
        <Text style={S.bodyText}>No signature analysis is supportable on the available evidence — N/A.</Text>
      </View>
    );
  }
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Signature Analysis</Text>
      {identity.signatureAnalyses.map((s) => (
        <View key={s.id}>
          <Text style={S.subsectionTitle}>{s.title}</Text>
          <Text style={S.bodyText}>{s.question}</Text>
          <Text style={S.footnote}>{`Depth ${s.depth} · Confidence ${s.confidence} · ${s.rationale}`}</Text>
        </View>
      ))}
    </View>
  );
}

export function DebateBlock({ identity }: { identity: ResearchDNA }) {
  if (identity.debates.debates.length === 0) {
    return (
      <View style={S.contentArea}>
        <Text style={S.sectionTitle}>Key Debates</Text>
        <Text style={S.bodyText}>No debates are supportable on the available evidence — N/A.</Text>
      </View>
    );
  }
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Key Debates</Text>
      {identity.debates.debates.map((d) => (
        <View key={d.id}>
          <Text style={S.subsectionTitle}>{`${d.central ? "★ " : ""}${d.question}`}</Text>
          {d.assumption ? <Text style={S.bodyText}>{`Assumption: ${d.assumption}`}</Text> : null}
          {d.difference ? <Text style={S.bodyText}>{`Point of difference: ${d.difference}`}</Text> : null}
          {d.mustHappen ? <Text style={S.bodyText}>{`What must happen: ${d.mustHappen}`}</Text> : null}
          {d.invalidate ? <Text style={S.bodyText}>{`What would invalidate: ${d.invalidate}`}</Text> : null}
          {!d.marketView.value ? (
            <Text style={S.footnote}>Consensus view: unavailable — no consensus evidence was supplied.</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function CoverIdentityBlock({ identity }: { identity: ResearchDNA }) {
  return (
    <View style={S.contentArea}>
      <Text style={S.footnote}>{identity.cover.eyebrow}</Text>
      <Text style={S.sectionTitle}>{identity.cover.title}</Text>
      <Text style={S.bodyText}>{identity.cover.subtitle}</Text>
    </View>
  );
}

export function PageAllocationBlock({ identity }: { identity: ResearchDNA }) {
  return (
    <View style={S.contentArea}>
      <Text style={S.sectionTitle}>Report Plan (emergent length, no cap)</Text>
      {identity.pageAllocation.allocations.map((a) => (
        <Text key={a.sectionId} style={S.footnote}>
          {`${a.title} — depth ${a.depth}, ≈${a.estimatedPages} pages (${a.chartCount} charts, ${a.tableCount} tables)`}
        </Text>
      ))}
      <Text style={S.footnote}>
        {`Total ≈${identity.pageAllocation.estimatedPages} pages from ${identity.pageAllocation.totalUnits} space units.`}
      </Text>
    </View>
  );
}
