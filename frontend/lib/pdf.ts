const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 54;

function estimateWidth(value: string, size: number): number {
  let units = 0;
  for (const character of value) {
    if (character === " ") units += 0.278;
    else if (character >= "0" && character <= "9") units += 0.556;
    else if (character >= "A" && character <= "Z") units += 0.68;
    else if (".,:;'`|!il[]".includes(character)) units += 0.278;
    else units += 0.556;
  }
  return units * size;
}

export type PdfTextOptions = {
  size?: number;
  bold?: boolean;
  gray?: number;
  indent?: number;
  gap?: number;
  leading?: number;
};

function ascii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\u0020-\u007E]/g, "?");
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(value: string, charactersPerLine: number): string[] {
  const source = value.length ? value : " ";
  const words = source.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    if (!line.length) {
      line = word;
      return;
    }
    if (line.length + 1 + word.length <= charactersPerLine) {
      line = `${line} ${word}`;
      return;
    }
    lines.push(line);
    line = word;
  });
  if (line.length) lines.push(line);

  return lines.flatMap((entry) => {
    if (entry.length <= charactersPerLine) return [entry];
    const chunks: string[] = [];
    for (let index = 0; index < entry.length; index += charactersPerLine) {
      chunks.push(entry.slice(index, index + charactersPerLine));
    }
    return chunks;
  });
}

export class PdfDocument {
  private pages: string[][] = [];
  private cursorY = PAGE_HEIGHT - MARGIN_TOP;

  constructor() {
    this.pages.push([]);
  }

  private get width(): number {
    return PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  private newPage() {
    this.pages.push([]);
    this.cursorY = PAGE_HEIGHT - MARGIN_TOP;
  }

  private ensure(height: number) {
    if (this.cursorY - height < MARGIN_BOTTOM) this.newPage();
  }

  text(value: unknown, options: PdfTextOptions = {}) {
    const size = options.size ?? 10;
    const bold = options.bold ?? false;
    const gray = options.gray ?? 0.15;
    const indent = options.indent ?? 0;
    const leading = size * (options.leading ?? 1.35);
    const charactersPerLine = Math.max(12, Math.floor((this.width - indent) / (size * 0.53)));
    const lines = wrapText(ascii(String(value ?? "")), charactersPerLine);
    const font = bold ? "F2" : "F1";
    const page = this.pages[this.pages.length - 1];

    lines.forEach((line) => {
      this.ensure(leading);
      const target = this.pages[this.pages.length - 1];
      const baseline = this.cursorY - size * 0.85;
      target.push(
        `BT /${font} ${size} Tf ${gray} g 1 0 0 1 ${MARGIN_LEFT + indent} ${baseline.toFixed(2)} Tm (${escapePdfText(line)}) Tj ET`,
      );
      this.cursorY -= leading;
    });

    this.cursorY -= options.gap ?? 4;
    return this;
  }

  row(
    cells: { text: string; offset: number; align?: "left" | "right"; size?: number; bold?: boolean; gray?: number }[],
    gap = 3,
  ) {
    const size = Math.max(...cells.map((cell) => cell.size ?? 9), 9);
    const leading = size * 1.35;
    this.ensure(leading);
    const page = this.pages[this.pages.length - 1];
    const baseline = this.cursorY - size * 0.85;

    cells.forEach((cell) => {
      const cellSize = cell.size ?? size;
      const text = ascii(String(cell.text ?? ""));
      const width = estimateWidth(text, cellSize);
      const x =
        cell.align === "right" ? MARGIN_LEFT + cell.offset - width : MARGIN_LEFT + Math.max(0, cell.offset);
      page.push(
        `BT /${cell.bold ? "F2" : "F1"} ${cellSize} Tf ${cell.gray ?? 0.15} g 1 0 0 1 ${x.toFixed(2)} ` +
          `${baseline.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`,
      );
    });

    this.cursorY -= leading + gap;
    return this;
  }

  rule(gap = 10, gray = 0.75) {
    this.ensure(8);
    const y = this.cursorY - 2;
    this.pages[this.pages.length - 1].push(
      `${gray} G 0.6 w ${MARGIN_LEFT} ${y.toFixed(2)} m ${(PAGE_WIDTH - MARGIN_RIGHT).toFixed(2)} ${y.toFixed(2)} l S`,
    );
    this.cursorY = y - gap;
    return this;
  }

  space(height = 8) {
    this.cursorY -= height;
    if (this.cursorY < MARGIN_BOTTOM) this.newPage();
    return this;
  }

  build(title: string) {
    const streams = this.pages.map((ops) => ops.join("\n"));
    const pageCount = streams.length;
    const infoId = 4 + pageCount * 2 + 1;
    const objectCount = infoId;

    const objects: string[] = new Array(objectCount + 1);
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    const kids = Array.from({ length: pageCount }, (_, index) => `${5 + index * 2} 0 R`).join(" ");
    objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[infoId] = `<< /Title (${escapePdfText(ascii(title))}) /Producer (APEX Terminal) >>`;

    streams.forEach((stream, index) => {
      const pageId = 5 + index * 2;
      const contentId = pageId + 1;
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> " +
        `/Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    const chunks: string[] = ["%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n"];
    let offset = chunks[0].length;
    const offsets: number[] = new Array(objectCount + 1).fill(0);

    for (let id = 1; id <= objectCount; id += 1) {
      offsets[id] = offset;
      const serialized = `${id} 0 obj\n${objects[id]}\nendobj\n`;
      chunks.push(serialized);
      offset += serialized.length;
    }

    const xrefOffset = offset;
    const xrefLines = [`xref\n0 ${objectCount + 1}\n`, "0000000000 65535 f \n"];
    for (let id = 1; id <= objectCount; id += 1) {
      xrefLines.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    }
    const trailer = `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n`;
    const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
    const body = [...chunks, ...xrefLines, trailer, tail].join("");

    const bytes = new Uint8Array(body.length);
    for (let index = 0; index < body.length; index += 1) {
      bytes[index] = body.charCodeAt(index) & 0xff;
    }
    return bytes;
  }
}
