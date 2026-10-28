export type SheetValue = string | number | boolean | null | undefined;
export type SheetRow = SheetValue[];
export type SheetConditionalFormat = { sqref: string; type: "dataBar" | "colorScale"; color?: string };
export type Sheet = {
  name: string;
  rows: SheetRow[];
  columnWidths?: number[];
  freeze?: { row: number; col: number };
  numericColumns?: number[];
  numberFormats?: Record<number, "money" | "percent" | "eps" | "number">;
  zebra?: boolean;
  conditionalFormats?: SheetConditionalFormat[];
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function columnName(index: number): string {
  let current = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return name;
}

function stringify(value: SheetValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Number(value.toPrecision(12)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  return String(value);
}

function isPercentHeader(header: string): boolean {
  const h = header.toLowerCase();
  return /margin|growth|roe|roic|roa|ratio|pct|%|cagr/.test(h);
}

function isEpsHeader(header: string): boolean {
  return /eps/.test(header.toLowerCase());
}

function autoSheetMeta(sheet: Sheet) {
  const rows = sheet.rows || [];
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = rows.length ? rows[0] : [];
  const numericColumns = sheet.numericColumns
    ? sheet.numericColumns
    : Array.from({ length: colCount }, (_, c) => c).filter((c) =>
        rows.slice(1).some((row) => typeof row[c] === "number" && Number.isFinite(row[c] as number)),
      );
  const numberFormats: Record<number, "money" | "percent" | "eps" | "number"> = { ...(sheet.numberFormats || {}) };
  numericColumns.forEach((c) => {
    if (numberFormats[c]) return;
    const header = String(headerRow[c] ?? "");
    if (isPercentHeader(header)) numberFormats[c] = "percent";
    else if (isEpsHeader(header)) numberFormats[c] = "eps";
    else numberFormats[c] = "money";
  });
  const columnWidths = sheet.columnWidths
    ? sheet.columnWidths
    : Array.from({ length: colCount }, (_, c) => {
        let max = 8;
        rows.forEach((row) => {
          const len = stringify(row[c]).length;
          if (len > max) max = len;
        });
        const headerLen = stringify(headerRow[c]).length;
        if (headerLen > max) max = headerLen;
        return Math.min(42, Math.max(10, max + 2));
      });
  const freeze = sheet.freeze ? sheet.freeze : rows.length > 1 && colCount > 1 ? { row: 1, col: 1 } : undefined;
  const zebra = sheet.zebra !== false;
  return { numericColumns, numberFormats, columnWidths, freeze, zebra, colCount };
}

// Style index constants (must match styles.xml generation)
const STYLE_NORMAL = 0;
const STYLE_HEADER = 1;
const STYLE_LABEL = 2;
const STYLE_MONEY = 3;
const STYLE_EPS = 4;
const STYLE_PERCENT = 5;
const STYLE_LABEL_ZEBRA = 6;
const STYLE_MONEY_ZEBRA = 7;
const STYLE_EPS_ZEBRA = 8;
const STYLE_PERCENT_ZEBRA = 9;
const STYLE_NORMAL_ZEBRA = 10;

function numberFormatId(format: "money" | "percent" | "eps" | "number"): number {
  switch (format) {
    case "percent":
      return 166;
    case "eps":
      return 165;
    case "number":
      return 0;
    default:
      return 164;
  }
}

function styleIndexFor(meta: ReturnType<typeof autoSheetMeta>, rowIndex: number, colIndex: number, value: SheetValue): number {
  const isHeader = rowIndex === 0;
  const isZebra = meta.zebra && rowIndex > 0 && rowIndex % 2 === 0;
  if (isHeader) return STYLE_HEADER;
  const isFirstCol = colIndex === 0;
  const isNumeric = meta.numericColumns.includes(colIndex);
  if (isFirstCol && !isNumeric) {
    return isZebra ? STYLE_LABEL_ZEBRA : STYLE_LABEL;
  }
  if (isNumeric) {
    const fmt = meta.numberFormats[colIndex] || "money";
    const base =
      fmt === "percent" ? STYLE_PERCENT : fmt === "eps" ? STYLE_EPS : fmt === "number" ? STYLE_NORMAL : STYLE_MONEY;
    if (isZebra) {
      if (fmt === "percent") return STYLE_PERCENT_ZEBRA;
      if (fmt === "eps") return STYLE_EPS_ZEBRA;
      if (fmt === "number") return STYLE_NORMAL_ZEBRA;
      return STYLE_MONEY_ZEBRA;
    }
    return base;
  }
  return isZebra ? STYLE_NORMAL_ZEBRA : STYLE_NORMAL;
}

function cellXml(reference: string, value: SheetValue, styleIndex: number): string {
  if (value === null || value === undefined || value === "") return "";
  const styleAttr = styleIndex > 0 ? ` s="${styleIndex}"` : "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    const clean = Number(value.toPrecision(12));
    return `<c r="${reference}"${styleAttr}><v>${clean}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}"${styleAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet, meta: ReturnType<typeof autoSheetMeta>): string {
  const rows = sheet.rows || [];
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const idx = styleIndexFor(meta, rowIndex, columnIndex, value);
          return cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value, idx);
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const colsXml = meta.columnWidths.length
    ? `<cols>${meta.columnWidths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  let freezeXml = "";
  if (meta.freeze) {
    const { row, col } = meta.freeze;
    const topLeft = `${columnName(col)}${row + 1}`;
    freezeXml =
      `<sheetViews><sheetView workbookViewId="0">` +
      `<pane xSplit="${col}" ySplit="${row}" topLeftCell="${topLeft}" activePane="bottomRight"/>` +
      `<selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>` +
      `</sheetView></sheetViews>`;
  }

  let cfXml = "";
  if (sheet.conditionalFormats && sheet.conditionalFormats.length) {
    cfXml = sheet.conditionalFormats
      .map((cf) => {
        if (cf.type === "dataBar") {
          return (
            `<conditionalFormatting sqref="${cf.sqref}">` +
            `<cfRule type="dataBar" priority="1">` +
            `<dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${cf.color || "FF5B9BD5"}"/></dataBar>` +
            `</cfRule></conditionalFormatting>`
          );
        }
        return "";
      })
      .join("");
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    freezeXml +
    colsXml +
    `<sheetData>${body}</sheetData>` +
    cfXml +
    "</worksheet>"
  );
}

function safeSheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
  let candidate = cleaned;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${cleaned.slice(0, 27)} ${suffix}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

type ZipEntry = { name: string; bytes: Uint8Array };

function buildZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;
  const dosTime = 0;
  const dosDate = (46 << 9) | (10 << 5) | 26;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const checksum = crc32(entry.bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localChunks.push(local, entry.bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.bytes.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    localOffset += local.length + entry.bytes.length;
  });

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  const total = localOffset + centralSize + end.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  [...localChunks, ...centralChunks, end].forEach((chunk) => {
    output.set(chunk, cursor);
    cursor += chunk.length;
  });
  return output;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0;[Red](#,##0)"/>
    <numFmt numFmtId="165" formatCode="0.00;[Red](0.00)"/>
    <numFmt numFmtId="166" formatCode="0.0%;[Red](0.0%)"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="166" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

export function buildXlsx(sheets: Sheet[]) {
  const used = new Set<string>();
  const named = sheets.map((sheet) => ({ ...sheet, name: safeSheetName(sheet.name, used) }));
  const safeNames = named.map((sheet) => sheet.name);

  const metas = named.map((sheet) => autoSheetMeta(sheet));

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    safeNames
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      )
      .join("") +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${safeNames
      .map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join("")}</sheets></workbook>`;

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    safeNames
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
          `Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${safeNames.length + 1}" ` +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", bytes: encode(contentTypes) },
    { name: "_rels/.rels", bytes: encode(rootRels) },
    { name: "xl/workbook.xml", bytes: encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", bytes: encode(workbookRels) },
    { name: "xl/styles.xml", bytes: encode(STYLES_XML) },
    ...named.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      bytes: encode(sheetXml(sheet, metas[index])),
    })),
  ];

  return buildZip(entries);
}
