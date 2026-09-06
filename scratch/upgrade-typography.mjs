import fs from "fs";
import path from "path";

const targetPath = "src/components/PDFDocument/index.tsx";
let content = fs.readFileSync(targetPath, "utf-8");

// 1. Upgrade dense narrative box text: 5.2 -> 6.6
content = content.replaceAll(
  "fontSize: 5.2, color: COLORS.textSecondary, lineHeight: 1.3",
  "fontSize: 6.6, color: COLORS.textSecondary, lineHeight: 1.35"
);

// 2. Upgrade dense box subheadings: 5.8 -> 7.2
content = content.replaceAll(
  'fontSize: 5.8, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 1',
  'fontSize: 7.2, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 1.5'
);

// 3. Upgrade dense box headers: 6.8 -> 7.8
content = content.replaceAll(
  'fontSize: 6.8, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 2.5',
  'fontSize: 7.8, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 2.5'
);
content = content.replaceAll(
  'fontSize: 6.8, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 2',
  'fontSize: 7.8, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 2'
);

// 4. Upgrade dense box padding: 4.5 -> 5.5
content = content.replaceAll(
  "padding: 4.5, backgroundColor: COLORS.offWhite, borderWidth: 0.5, borderColor: COLORS.hairlineLight",
  "padding: 5.5, backgroundColor: COLORS.offWhite, borderWidth: 0.5, borderColor: COLORS.hairlineLight"
);
content = content.replaceAll(
  "padding: 4, backgroundColor: COLORS.offWhite, borderWidth: 0.5, borderColor: COLORS.hairlineLight",
  "padding: 5.5, backgroundColor: COLORS.offWhite, borderWidth: 0.5, borderColor: COLORS.hairlineLight"
);

// 5. Upgrade Cover page sidebar miniature fonts
content = content.replaceAll(
  "fontSize: 5.0, color: COLORS.textSecondary, maxWidth: \"78%\"",
  "fontSize: 5.8, color: COLORS.textSecondary, maxWidth: \"78%\""
);
content = content.replaceAll(
  "fontSize: 5.0, fontFamily: \"Helvetica-Bold\", color: COLORS.slateDark",
  "fontSize: 5.8, fontFamily: \"Helvetica-Bold\", color: COLORS.slateDark"
);
content = content.replaceAll(
  "fontSize: 4.8, fontFamily: \"Helvetica-Bold\", color: COLORS.primaryRed",
  "fontSize: 5.8, fontFamily: \"Helvetica-Bold\", color: COLORS.primaryRed"
);
content = content.replaceAll(
  "fontSize: 4.8, color: COLORS.textMuted",
  "fontSize: 5.6, color: COLORS.textMuted"
);
content = content.replaceAll(
  "fontSize: 4.5, color: COLORS.textMuted, lineHeight: 1.2",
  "fontSize: 5.6, color: COLORS.textMuted, lineHeight: 1.25"
);
content = content.replaceAll(
  "fontSize: 4.8, fontFamily: \"Helvetica-Bold\", color: COLORS.slateDark, marginBottom: 1",
  "fontSize: 6.2, fontFamily: \"Helvetica-Bold\", color: COLORS.slateDark, marginBottom: 1"
);
content = content.replaceAll(
  "fontSize: 4.7, color: COLORS.textSecondary",
  "fontSize: 5.6, color: COLORS.textSecondary"
);
content = content.replaceAll(
  "fontSize: 4.7, fontFamily: \"Helvetica-Bold\", textAlign: \"right\", color: COLORS.slateDark",
  "fontSize: 5.6, fontFamily: \"Helvetica-Bold\", textAlign: \"right\", color: COLORS.slateDark"
);
content = content.replaceAll(
  "fontSize: 5.1, color: COLORS.textMuted",
  "fontSize: 5.8, color: COLORS.textMuted"
);
content = content.replaceAll(
  "fontSize: 5.1, color: COLORS.textMuted, lineHeight: 1.25, marginBottom: 4",
  "fontSize: 5.8, color: COLORS.textMuted, lineHeight: 1.25, marginBottom: 4"
);
content = content.replaceAll(
  "fontSize: 5.3, color: COLORS.textMuted",
  "fontSize: 6.0, color: COLORS.textMuted"
);
content = content.replaceAll(
  "fontSize: 5.6, color: COLORS.textMuted",
  "fontSize: 6.2, color: COLORS.textMuted"
);

// 6. Upgrade Right Rail Vital stats and summaries
content = content.replaceAll(
  "fontSize: 5.5, color: COLORS.textMuted",
  "fontSize: 6.2, color: COLORS.textMuted"
);
content = content.replaceAll(
  "fontSize: 5.6, fontFamily: \"Helvetica-Bold\", color: COLORS.slateDark",
  "fontSize: 6.2, fontFamily: \"Helvetica-Bold\", color: COLORS.slateDark"
);
content = content.replaceAll(
  "fontSize: 5.2, fontFamily: \"Helvetica-Bold\", paddingLeft: 2",
  "fontSize: 6.0, fontFamily: \"Helvetica-Bold\", paddingLeft: 2"
);
content = content.replaceAll(
  "fontSize: 5.2, fontFamily: \"Helvetica-Bold\", textAlign: \"right\", paddingRight: 2",
  "fontSize: 6.0, fontFamily: \"Helvetica-Bold\", textAlign: \"right\", paddingRight: 2"
);
content = content.replaceAll(
  "fontSize: 5.2, color: COLORS.textSecondary, paddingLeft: 2",
  "fontSize: 6.0, color: COLORS.textSecondary, paddingLeft: 2"
);
content = content.replaceAll(
  "fontSize: 5.2, textAlign: \"right\", paddingRight: 2, color: COLORS.slateDark",
  "fontSize: 6.0, textAlign: \"right\", paddingRight: 2, color: COLORS.slateDark"
);
content = content.replaceAll(
  "fontSize: 5.6, color: COLORS.textSecondary, lineHeight: 1.25, textAlign: \"justify\", marginBottom: 3",
  "fontSize: 6.4, color: COLORS.textSecondary, lineHeight: 1.3, textAlign: \"justify\", marginBottom: 3"
);

fs.writeFileSync(targetPath, content, "utf-8");
console.log("Successfully upgraded typography across index.tsx!");
