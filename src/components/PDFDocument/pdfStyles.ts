// ============================================================
// PDF Document styles — Institutional Research Format
// Replicating Institutional Equity Research & Corporate Credit Dossier
// ============================================================
import { StyleSheet } from "@react-pdf/renderer";

export const COLORS = {
  // Institutional Brand Colors
  primaryRed: "#e01a22",        // Primary Red Accent
  primaryDark: "#111827",       // Near Black for body and headings
  slate: "#1f2937",
  slateLight: "#4b5563",
  muted: "#6b7280",
  faint: "#9ca3af",
  
  // Neutrals & Hairlines
  white: "#ffffff",
  offWhite: "#f9fafb",
  lightGray: "#f3f4f6",
  hairline: "#000000",           // Signature black divider
  hairlineLight: "#d1d5db",      // Table & box borders
  hairlineFaint: "#e5e7eb",
  
  // Indicators
  green: "#059669",
  red: "#dc2626",
  amber: "#d97706",
  
  // Backward compatibility aliases
  slateDark: "#111827",
  slateMid: "#374151",
  cobalt: "#e01a22",             // Primary Red Accent
  cobaltDark: "#111827",
  cobaltLight: "#fef2f2",
  border: "#d1d5db",
  borderDark: "#9ca3af",
  textPrimary: "#111827",
  textSecondary: "#374151",
  textMuted: "#6b7280",
  textFaint: "#9ca3af",
  greenBg: "#ecfdf5",
  greenBorder: "#a7f3d0",
  redBg: "#fef2f2",
  redBorder: "#fecaca",
  amberBg: "#fffbeb",
  navy: "#111827",
  navyDark: "#111827",
  navyLight: "#374151",
  navyMid: "#4b5563",
  gold: "#e01a22",
  goldLight: "#fef2f2",
  midGray: "#d1d5db",
  darkGray: "#374151",
  textLight: "#6b7280",
  yellow: "#d97706",
  yellowLight: "#fffbeb",
  greenLight: "#ecfdf5",
  redLight: "#fef2f2",
  tableHeader: "#f3f4f6",
  tableHeaderText: "#111827",
  rowAlt: "#f9fafb",
};

export const FONT_SIZES = {
  coverTitle: 18,
  headline: 13.5,
  sectionTitle: 12.0,
  subsectionTitle: 10.0,
  body: 8.5,
  small: 7.8,
  tiny: 6.5,
  tableHeader: 7.2,
  tableBody: 7.2,
  footnote: 6.0,
};

export const pdfStyles = StyleSheet.create({
  // ── Standard Research Page ───────────────────────────────
  page: {
    fontFamily: "Helvetica",
    backgroundColor: COLORS.white,
    paddingTop: 36,
    paddingBottom: 32,
    paddingLeft: 34,
    paddingRight: 34,
    fontSize: FONT_SIZES.body,
    color: COLORS.textPrimary,
  },
  coverPage: {
    fontFamily: "Helvetica",
    backgroundColor: COLORS.white,
    paddingTop: 24,
    paddingBottom: 28,
    paddingLeft: 30,
    paddingRight: 30,
    fontSize: FONT_SIZES.body,
    color: COLORS.textPrimary,
  },

  // ── Top Header Band ──────────────────────────────
  header: {
    position: "absolute",
    top: 0,
    left: 34,
    right: 34,
    height: 28,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.hairline,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    color: COLORS.textSecondary,
    fontSize: 7.5,
    fontFamily: "Helvetica",
    letterSpacing: 0.3,
  },
  headerRight: {
    color: COLORS.primaryRed,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
  },

  // ── Running Footer ───────────────────────────────
  footer: {
    position: "absolute",
    bottom: 0,
    left: 34,
    right: 34,
    height: 26,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hairlineLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.footnote,
    maxWidth: "88%",
    lineHeight: 1.2,
  },
  footerPage: {
    color: COLORS.textPrimary,
    fontSize: 6.8,
    fontFamily: "Helvetica",
  },

  // ── 10-Column KPI Header Strip ───────────────────
  kpiStrip: {
    flexDirection: "row",
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    backgroundColor: COLORS.white,
    marginBottom: 10,
  },
  kpiCol: {
    flex: 1,
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderRightWidth: 0.5,
    borderRightColor: COLORS.hairlineLight,
    alignItems: "flex-start",
  },
  kpiColLast: {
    flex: 1.2,
    paddingVertical: 3,
    paddingHorizontal: 3,
    alignItems: "flex-start",
  },
  kpiLabel: {
    fontSize: 5.6,
    color: COLORS.textMuted,
    marginBottom: 1.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "capitalize",
  },
  kpiValue: {
    fontSize: 6.8,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
  },
  kpiValueBold: {
    fontSize: 6.8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
  },

  // ── Editorial Headline Banner ────────────────────────────────
  headlineBanner: {
    fontSize: FONT_SIZES.headline,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    lineHeight: 1.35,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineLight,
  },

  // ── Section Titles ───────────────────────────────────────────
  sectionTitleContainer: {
    marginBottom: 6,
    marginTop: 2,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.hairline,
    paddingBottom: 3,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.sectionTitle,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    letterSpacing: 0.2,
  },
  subsectionTitle: {
    fontSize: FONT_SIZES.subsectionTitle,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    marginBottom: 3,
    marginTop: 5,
  },

  // ── Body Typography ──────────────────────────────────────────
  bodyText: {
    fontSize: FONT_SIZES.body,
    color: COLORS.textSecondary,
    lineHeight: 1.45,
    marginBottom: 4,
    textAlign: "justify",
  },
  bodyTextSmall: {
    fontSize: FONT_SIZES.small,
    color: COLORS.textSecondary,
    lineHeight: 1.35,
    marginBottom: 3,
  },
  footnote: {
    fontSize: FONT_SIZES.footnote,
    color: COLORS.textMuted,
    lineHeight: 1.2,
    marginTop: 3,
  },

  // ── Content Area & Columns ───────────────────────────────────
  contentArea: {
    flex: 1,
  },
  col2: {
    flexDirection: "row",
    gap: 10,
  },
  col3: {
    flexDirection: "row",
    gap: 8,
  },

  // ── Compact Data Tables ──────────────────────────
  table: {
    width: "100%",
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineFaint,
    minHeight: 13,
    alignItems: "center",
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineFaint,
    minHeight: 13,
    alignItems: "center",
    backgroundColor: COLORS.rowAlt,
  },
  tableRowHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.lightGray,
    minHeight: 14,
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineLight,
  },
  tableRowSubHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.lightGray,
    minHeight: 13,
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineLight,
  },
  tableCell: {
    fontSize: FONT_SIZES.tableBody,
    color: COLORS.textPrimary,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  tableCellHeader: {
    fontSize: FONT_SIZES.tableHeader,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    paddingHorizontal: 4,
    paddingVertical: 2.5,
  },
  tableCellBold: {
    fontSize: FONT_SIZES.tableBody,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  tableCellRight: {
    fontSize: FONT_SIZES.tableBody,
    color: COLORS.textPrimary,
    paddingHorizontal: 4,
    paddingVertical: 2,
    textAlign: "right",
  },
  tableCellBoldRight: {
    fontSize: FONT_SIZES.tableBody,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    paddingHorizontal: 4,
    paddingVertical: 2,
    textAlign: "right",
  },
  tableCellHeaderRight: {
    fontSize: FONT_SIZES.tableHeader,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    paddingHorizontal: 4,
    paddingVertical: 2.5,
    textAlign: "right",
  },

  // ── Metric Boxes ─────────────────────────────────────────────
  metricsRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 6,
  },
  metricBox: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    padding: 4,
    alignItems: "flex-start",
  },
  metricBoxNavy: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    padding: 4,
    alignItems: "flex-start",
  },
  metricLabel: {
    fontSize: 5.8,
    color: COLORS.textMuted,
    marginBottom: 1.5,
  },
  metricLabelWhite: {
    fontSize: 5.8,
    color: COLORS.textSecondary,
    marginBottom: 1.5,
  },
  metricValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
  },
  metricValueWhite: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
  },

  // ── Callout Boxes ────────────────────────────────────────────
  calloutBox: {
    backgroundColor: COLORS.white,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primaryRed,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    padding: 6,
    marginBottom: 6,
  },
  calloutTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  calloutText: {
    fontSize: 6.8,
    color: COLORS.textSecondary,
    lineHeight: 1.35,
  },

  // ── Recommendation Badges ────────────────────────────────────
  recBadgeBuy: {
    backgroundColor: COLORS.green,
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  recBadgeHold: {
    backgroundColor: COLORS.amber,
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  recBadgeSell: {
    backgroundColor: COLORS.red,
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  recBadgeText: {
    color: COLORS.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    letterSpacing: 0.4,
  },

  // ── Visual Dividers ──────────────────────────────────────────
  divider: {
    height: 0.5,
    backgroundColor: COLORS.hairlineLight,
    marginVertical: 4,
  },
  goldDivider: {
    height: 0.75,
    backgroundColor: COLORS.hairline,
    marginVertical: 4,
  },

  // ── Legal & Regulatory Styles ────────────────────────────────
  legalSectionTitle: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginBottom: 3,
  },
  legalSubSectionTitle: {
    fontSize: 7.8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginTop: 4,
    marginBottom: 2,
  },
  legalParagraph: {
    fontSize: 6.2,
    color: COLORS.textSecondary,
    lineHeight: 1.3,
    marginBottom: 3,
    textAlign: "justify",
  },
  legalNoticeBox: {
    backgroundColor: COLORS.offWhite,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primaryRed,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    padding: 5,
    marginBottom: 5,
  },
  legalNoticeTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginBottom: 1.5,
  },
  legalNoticeText: {
    fontSize: 6.2,
    color: COLORS.textSecondary,
    lineHeight: 1.3,
  },
  legalNumberedTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    marginBottom: 1,
  },
  legalClauseNum: {
    fontFamily: "Helvetica-Bold",
    color: COLORS.primaryRed,
  },
  legalHeaderBar: {
    backgroundColor: COLORS.lightGray,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    padding: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  legalRatingsBox: {
    backgroundColor: COLORS.white,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    padding: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },

  // ── Credit Rating Specific Layouts ───────────────
  creditHeaderTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    marginBottom: 4,
  },
  creditSubTitle: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    marginBottom: 2.5,
  },
  creditSectionBand: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineLight,
    paddingBottom: 2,
    marginBottom: 6,
    marginTop: 6,
  },
  creditProcessCol: {
    flex: 1,
    paddingRight: 4,
  },
  creditProcessCircle: {
    width: 58,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#2c5282",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
    paddingHorizontal: 4,
  },
  creditProcessCircleText: {
    fontSize: 6.2,
    fontFamily: "Helvetica-Bold",
    color: COLORS.white,
    textAlign: "center",
  },

  // ── Dense Financial Table Layouts ─────────────────────────────
  compactTable: {
    width: "100%",
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
  },
  compactRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineFaint,
    minHeight: 14.5,
    alignItems: "center",
  },
  compactRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineFaint,
    minHeight: 14.5,
    alignItems: "center",
    backgroundColor: COLORS.rowAlt,
  },
  compactRowHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.lightGray,
    minHeight: 16,
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairlineLight,
  },
  compactCell: {
    fontSize: 6.8,
    color: COLORS.textPrimary,
    paddingHorizontal: 3.5,
    paddingVertical: 2.0,
  },
  compactCellBold: {
    fontSize: 6.8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    paddingHorizontal: 3.5,
    paddingVertical: 2.0,
  },
  compactCellRight: {
    fontSize: 6.8,
    color: COLORS.textPrimary,
    paddingHorizontal: 3.5,
    paddingVertical: 2.0,
    textAlign: "right",
  },
  compactCellHeader: {
    fontSize: 6.8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    paddingHorizontal: 3.5,
    paddingVertical: 2.4,
  },
  compactCellHeaderRight: {
    fontSize: 6.8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    paddingHorizontal: 3.5,
    paddingVertical: 2.4,
    textAlign: "right",
  },
  compactCellBoldRight: {
    fontSize: 6.8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    paddingHorizontal: 3.5,
    paddingVertical: 2.0,
    textAlign: "right",
  },

  // ── Analytical Notes & Callout Containers ───────────────────────
  denseBox: {
    padding: 5.5,
    backgroundColor: COLORS.offWhite,
    borderWidth: 0.5,
    borderColor: COLORS.hairlineLight,
    marginBottom: 5,
  },
  denseBoxTitle: {
    fontSize: 7.8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    marginBottom: 3,
  },
  denseBoxSubTitle: {
    fontSize: 7.2,
    fontFamily: "Helvetica-Bold",
    color: COLORS.slateDark,
    marginBottom: 1.5,
  },
  denseBoxText: {
    fontSize: 6.6,
    color: COLORS.textSecondary,
    lineHeight: 1.35,
    textAlign: "justify",
    marginBottom: 2,
  },
});
