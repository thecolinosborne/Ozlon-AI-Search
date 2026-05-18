import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const DOCS_BASE = "https://docs.googleapis.com/v1/documents";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

type AnyJson = Record<string, unknown>;
type DocReq = AnyJson;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new Error(`Docs API ${res.status}: ${await res.text()}`);
    return res;
  }
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Docs API ${res.status}: ${JSON.stringify(data)}`);
  return data as AnyJson;
}

function getBodyEndIndex(doc: AnyJson): number {
  const body = (doc as AnyJson).body as AnyJson | undefined;
  const content = (body?.content as AnyJson[]) || [];
  let end = 1;
  for (const el of content) {
    const ei = (el as AnyJson).endIndex as number | undefined;
    if (typeof ei === "number" && ei > end) end = ei;
  }
  return end;
}

async function batchUpdate(token: string, documentId: string, requests: DocReq[]) {
  if (requests.length === 0) return {};
  return await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

// ─────────────────────────────────────────────────────────────
// THEME — "Minimal Apple Memo"
// ─────────────────────────────────────────────────────────────
const THEME = {
  fontBody: "Inter",
  fontMono: "Roboto Mono",
  bodySize: 11,
  bodyLine: 135, // line spacing × 100
  bodySpaceBelow: 8,
  titleSize: 28,
  titleSpaceBelow: 24,
  subtitleSize: 13,
  metaSize: 10,
  metaSpaceBelow: 16,
  h2Size: 18,
  h2SpaceAbove: 20,
  h2SpaceBelow: 6,
  h3Size: 13,
  h3SpaceAbove: 12,
  h3SpaceBelow: 4,
  eyebrowSize: 9,
  eyebrowSpaceBelow: 4,
  codeSize: 10,
  quoteIndent: 18,
  bulletIndentPerLevel: 18,
  pageMarginVertical: 72,
  pageMarginHorizontal: 90,
  grayMid: { red: 0.42, green: 0.42, blue: 0.42 },     // #6B6B6B
  grayLight: { red: 0.54, green: 0.54, blue: 0.54 },   // #8A8A8A
  codeBg: { red: 0.949, green: 0.949, blue: 0.949 },   // #F2F2F2
  codeBlockBg: { red: 0.969, green: 0.969, blue: 0.969 }, // #F7F7F7
  tableHeaderBg: { red: 0.961, green: 0.961, blue: 0.961 }, // #F5F5F5
};

function pt(magnitude: number) { return { magnitude, unit: "PT" }; }
function rgb(c: { red: number; green: number; blue: number }) { return { color: { rgbColor: c } }; }
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
  };
}

// Document-level theme requests (page setup). Run once per doc.
function documentThemeRequests(): DocReq[] {
  return [{
    updateDocumentStyle: {
      documentStyle: {
        marginTop: pt(THEME.pageMarginVertical),
        marginBottom: pt(THEME.pageMarginVertical),
        marginLeft: pt(THEME.pageMarginHorizontal),
        marginRight: pt(THEME.pageMarginHorizontal),
      },
      fields: "marginTop,marginBottom,marginLeft,marginRight",
    },
  }];
}

// Apply baseline body font + line spacing to a range.
function baselineStyleRequests(startIndex: number, endIndex: number): DocReq[] {
  if (endIndex <= startIndex) return [];
  return [
    {
      updateTextStyle: {
        range: { startIndex, endIndex },
        textStyle: {
          weightedFontFamily: { fontFamily: THEME.fontBody },
          fontSize: pt(THEME.bodySize),
        },
        fields: "weightedFontFamily,fontSize",
      },
    },
    {
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle: {
          lineSpacing: THEME.bodyLine,
          spaceAbove: pt(0),
          spaceBelow: pt(THEME.bodySpaceBelow),
        },
        fields: "lineSpacing,spaceAbove,spaceBelow",
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// Markdown tokenizer (block-level)
// ─────────────────────────────────────────────────────────────
type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "eyebrow"; text: string }
  | { kind: "para"; text: string }
  | { kind: "bullet"; level: number; text: string; ordered: boolean }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "code"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "blank" };

function tokenizeMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");

    // fenced code
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      out.push({ kind: "code", text: buf.join("\n") });
      continue;
    }

    // horizontal rule
    if (/^(\s*)(---+|\*\*\*+|___+)\s*$/.test(line)) { out.push({ kind: "hr" }); i++; continue; }

    // GFM table: header line followed by separator |---|
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const splitRow = (s: string) =>
        s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const headers = splitRow(line);
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push({ kind: "table", headers, rows });
      continue;
    }

    if (!line.trim()) { out.push({ kind: "blank" }); i++; continue; }

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^####\s+(.*)$/))) { out.push({ kind: "eyebrow", text: m[1] }); i++; continue; }
    if ((m = line.match(/^###\s+(.*)$/)))  { out.push({ kind: "heading", level: 3, text: m[1] }); i++; continue; }
    if ((m = line.match(/^##\s+(.*)$/)))   { out.push({ kind: "heading", level: 2, text: m[1] }); i++; continue; }
    if ((m = line.match(/^#\s+(.*)$/)))    { out.push({ kind: "heading", level: 1, text: m[1] }); i++; continue; }
    if ((m = line.match(/^>\s?(.*)$/)))    { out.push({ kind: "quote", text: m[1] }); i++; continue; }

    // bullets (indent-aware)
    if ((m = raw.match(/^(\s*)[-*]\s+(.*)$/))) {
      const indent = m[1].replace(/\t/g, "  ").length;
      out.push({ kind: "bullet", level: Math.floor(indent / 2), text: m[2], ordered: false });
      i++; continue;
    }
    if ((m = raw.match(/^(\s*)\d+\.\s+(.*)$/))) {
      const indent = m[1].replace(/\t/g, "  ").length;
      out.push({ kind: "bullet", level: Math.floor(indent / 2), text: m[2], ordered: true });
      i++; continue;
    }

    out.push({ kind: "para", text: line });
    i++;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Inline parser — emits styled segments
// ─────────────────────────────────────────────────────────────
type Seg = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: string;
};

function parseInline(s: string): Seg[] {
  const out: Seg[] = [];
  // Order matters: links first (consume []()), then bold, italic, code, strike.
  // We do a single-pass char walker for robustness.
  let i = 0;
  let buf = "";
  const flush = (extra?: Partial<Seg>) => {
    if (buf || extra) {
      out.push({ text: buf, ...(extra || {}) });
      buf = "";
    }
  };
  while (i < s.length) {
    const ch = s[i];
    // link [text](url)
    if (ch === "[") {
      const close = s.indexOf("]", i + 1);
      if (close > i && s[close + 1] === "(") {
        const urlEnd = s.indexOf(")", close + 2);
        if (urlEnd > close) {
          const label = s.slice(i + 1, close);
          const url = s.slice(close + 2, urlEnd);
          if (buf) { out.push({ text: buf }); buf = ""; }
          out.push({ text: label, link: url });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    if (ch === "*" && s[i + 1] === "*") {
      const close = s.indexOf("**", i + 2);
      if (close > i + 2) {
        if (buf) { out.push({ text: buf }); buf = ""; }
        out.push({ text: s.slice(i + 2, close), bold: true });
        i = close + 2;
        continue;
      }
    }
    if (ch === "*") {
      const close = s.indexOf("*", i + 1);
      if (close > i + 1) {
        if (buf) { out.push({ text: buf }); buf = ""; }
        out.push({ text: s.slice(i + 1, close), italic: true });
        i = close + 1;
        continue;
      }
    }
    if (ch === "`") {
      const close = s.indexOf("`", i + 1);
      if (close > i + 1) {
        if (buf) { out.push({ text: buf }); buf = ""; }
        out.push({ text: s.slice(i + 1, close), code: true });
        i = close + 1;
        continue;
      }
    }
    if (ch === "~" && s[i + 1] === "~") {
      const close = s.indexOf("~~", i + 2);
      if (close > i + 2) {
        if (buf) { out.push({ text: buf }); buf = ""; }
        out.push({ text: s.slice(i + 2, close), strike: true });
        i = close + 2;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  if (buf) out.push({ text: buf });
  return out;
}

function inlineStyleRequest(start: number, end: number, seg: Seg): DocReq | null {
  const ts: AnyJson = {};
  const fields: string[] = [];
  if (seg.bold) { ts.bold = true; fields.push("bold"); }
  if (seg.italic) { ts.italic = true; fields.push("italic"); }
  if (seg.strike) { ts.strikethrough = true; fields.push("strikethrough"); }
  if (seg.code) {
    ts.weightedFontFamily = { fontFamily: THEME.fontMono };
    ts.backgroundColor = rgb(THEME.codeBg);
    ts.fontSize = pt(THEME.codeSize);
    fields.push("weightedFontFamily", "backgroundColor", "fontSize");
  }
  if (seg.link) {
    ts.link = { url: seg.link };
    ts.foregroundColor = rgb({ red: 0.11, green: 0.36, blue: 0.86 });
    ts.underline = true;
    fields.push("link", "foregroundColor", "underline");
  }
  if (fields.length === 0) return null;
  return { updateTextStyle: { range: { startIndex: start, endIndex: end }, textStyle: ts, fields: fields.join(",") } };
}

// ─────────────────────────────────────────────────────────────
// Block renderer — for everything EXCEPT tables.
// Tables are handled in a second pass with insertTable + refetch.
// Returns { requests, fullText, endIndex, bulletGroups }
// ─────────────────────────────────────────────────────────────
type RenderedSegment = {
  requests: DocReq[];
  fullText: string;
  bulletGroups: Array<{ start: number; end: number; ordered: boolean; level: number }>;
};

function renderNonTableBlocks(blocks: Block[], startIndex: number): RenderedSegment {
  const requests: DocReq[] = [];
  const bulletGroups: RenderedSegment["bulletGroups"] = [];
  let cursor = startIndex;
  let fullText = "";

  type BlockRange = { start: number; end: number; block: Block };
  const ranges: BlockRange[] = [];

  for (const b of blocks) {
    const blockStart = cursor;
    let text = "";
    let segs: Seg[] = [];

    switch (b.kind) {
      case "blank": text = "\n"; break;
      case "hr": text = "\n"; break; // empty paragraph; styled with border
      case "code": text = b.text + "\n"; break;
      case "heading":
      case "eyebrow":
      case "para":
      case "bullet":
      case "quote": {
        const raw = b.kind === "eyebrow" ? b.text.toUpperCase() : b.text;
        segs = parseInline(raw);
        text = segs.map((s) => s.text).join("") + "\n";
        break;
      }
      default: text = "\n";
    }

    fullText += text;
    cursor += text.length;
    ranges.push({ start: blockStart, end: cursor, block: b });

    // Track inline spans for later styling
    if (segs.length > 0) {
      let segCursor = blockStart;
      for (const seg of segs) {
        const segStart = segCursor;
        const segEnd = segCursor + seg.text.length;
        const req = inlineStyleRequest(segStart, segEnd, seg);
        if (req) requests.push(req);
        segCursor = segEnd;
      }
    }
  }

  if (fullText.length === 0) return { requests: [], fullText: "", bulletGroups };

  // 1) Insert the whole text first
  requests.unshift({ insertText: { location: { index: startIndex }, text: fullText } });

  // 2) Apply baseline (font + line spacing) to the whole inserted range
  requests.push(...baselineStyleRequests(startIndex, cursor));

  // 3) Per-block paragraph styling
  for (const r of ranges) {
    if (r.end <= r.start) continue;
    const b = r.block;
    if (b.kind === "heading") {
      const namedStyle = b.level === 1 ? "HEADING_1" : b.level === 2 ? "HEADING_2" : "HEADING_3";
      const size = b.level === 1 ? THEME.titleSize : b.level === 2 ? THEME.h2Size : THEME.h3Size;
      const above = b.level === 1 ? 0 : b.level === 2 ? THEME.h2SpaceAbove : THEME.h3SpaceAbove;
      const below = b.level === 1 ? THEME.titleSpaceBelow : b.level === 2 ? THEME.h2SpaceBelow : THEME.h3SpaceBelow;
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: {
            namedStyleType: namedStyle,
            spaceAbove: pt(above),
            spaceBelow: pt(below),
            lineSpacing: 115,
          },
          fields: "namedStyleType,spaceAbove,spaceBelow,lineSpacing",
        },
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: r.start, endIndex: Math.max(r.start + 1, r.end - 1) },
          textStyle: {
            fontSize: pt(size),
            bold: b.level <= 2,
            weightedFontFamily: { fontFamily: THEME.fontBody },
            foregroundColor: rgb({ red: 0.07, green: 0.07, blue: 0.07 }),
          },
          fields: "fontSize,bold,weightedFontFamily,foregroundColor",
        },
      });
    } else if (b.kind === "eyebrow") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: {
            namedStyleType: "NORMAL_TEXT",
            spaceAbove: pt(12),
            spaceBelow: pt(THEME.eyebrowSpaceBelow),
          },
          fields: "namedStyleType,spaceAbove,spaceBelow",
        },
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: r.start, endIndex: Math.max(r.start + 1, r.end - 1) },
          textStyle: {
            fontSize: pt(THEME.eyebrowSize),
            bold: true,
            foregroundColor: rgb(THEME.grayLight),
            weightedFontFamily: { fontFamily: THEME.fontBody },
          },
          fields: "fontSize,bold,foregroundColor,weightedFontFamily",
        },
      });
    } else if (b.kind === "quote") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: {
            indentStart: pt(THEME.quoteIndent),
            indentFirstLine: pt(THEME.quoteIndent),
            spaceAbove: pt(6),
            spaceBelow: pt(6),
            borderLeft: { color: rgb(THEME.grayLight), width: pt(1.5), padding: pt(8), dashStyle: "SOLID" },
          },
          fields: "indentStart,indentFirstLine,spaceAbove,spaceBelow,borderLeft",
        },
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: r.start, endIndex: Math.max(r.start + 1, r.end - 1) },
          textStyle: { italic: true, foregroundColor: rgb(THEME.grayMid) },
          fields: "italic,foregroundColor",
        },
      });
    } else if (b.kind === "hr") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: {
            spaceAbove: pt(12),
            spaceBelow: pt(12),
            borderBottom: { color: rgb({ red: 0.85, green: 0.85, blue: 0.85 }), width: pt(0.75), padding: pt(0), dashStyle: "SOLID" },
          },
          fields: "spaceAbove,spaceBelow,borderBottom",
        },
      });
    } else if (b.kind === "code") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: {
            indentStart: pt(12),
            indentFirstLine: pt(12),
            spaceAbove: pt(6),
            spaceBelow: pt(6),
            shading: { backgroundColor: rgb(THEME.codeBlockBg) },
          },
          fields: "indentStart,indentFirstLine,spaceAbove,spaceBelow,shading",
        },
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: r.start, endIndex: Math.max(r.start + 1, r.end - 1) },
          textStyle: {
            weightedFontFamily: { fontFamily: THEME.fontMono },
            fontSize: pt(THEME.codeSize),
          },
          fields: "weightedFontFamily,fontSize",
        },
      });
    } else if (b.kind === "bullet") {
      // Apply indent based on level; we'll add bullets in a grouped pass below
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: r.start, endIndex: r.end },
          paragraphStyle: {
            indentStart: pt(b.level * THEME.bulletIndentPerLevel),
            spaceAbove: pt(0),
            spaceBelow: pt(2),
          },
          fields: "indentStart,spaceAbove,spaceBelow",
        },
      });
    }
  }

  // 4) Group consecutive bullets of same ordered-ness for createParagraphBullets
  let i = 0;
  while (i < ranges.length) {
    const r = ranges[i];
    if (r.block.kind !== "bullet") { i++; continue; }
    const ordered = r.block.ordered;
    let j = i;
    while (j + 1 < ranges.length && ranges[j + 1].block.kind === "bullet" && (ranges[j + 1].block as { ordered: boolean }).ordered === ordered) j++;
    const group = { start: ranges[i].start, end: ranges[j].end, ordered, level: 0 };
    bulletGroups.push(group);
    requests.push({
      createParagraphBullets: {
        range: { startIndex: group.start, endIndex: group.end },
        bulletPreset: ordered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
    i = j + 1;
  }

  return { requests, fullText, bulletGroups };
}

// Render markdown into a doc, handling tables via multi-pass (insertTable + refetch).
async function renderMarkdownIntoDoc(token: string, documentId: string, markdown: string, replaceAll: boolean) {
  const blocks = tokenizeMarkdown(markdown);

  // Wipe or position
  if (replaceAll) {
    const doc = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
    const end = getBodyEndIndex(doc);
    const wipe: DocReq[] = [];
    if (end > 2) wipe.push({ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } });
    wipe.push(...documentThemeRequests());
    await batchUpdate(token, documentId, wipe);
  } else {
    await batchUpdate(token, documentId, documentThemeRequests());
  }

  // Split blocks into runs separated by tables
  const runs: Array<{ kind: "text"; blocks: Block[] } | { kind: "table"; table: Extract<Block, { kind: "table" }> }> = [];
  let buf: Block[] = [];
  for (const b of blocks) {
    if (b.kind === "table") {
      if (buf.length) { runs.push({ kind: "text", blocks: buf }); buf = []; }
      runs.push({ kind: "table", table: b });
    } else {
      buf.push(b);
    }
  }
  if (buf.length) runs.push({ kind: "text", blocks: buf });

  // Process each run sequentially, fetching end index between runs that include tables
  let totalApplied = 0;
  for (const run of runs) {
    const doc = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
    const insertAt = Math.max(1, getBodyEndIndex(doc) - 1);

    if (run.kind === "text") {
      const seg = renderNonTableBlocks(run.blocks, insertAt);
      if (seg.requests.length === 0) continue;
      await batchUpdate(token, documentId, seg.requests);
      totalApplied += seg.requests.length;
    } else {
      const t = run.table;
      const rows = t.rows.length + 1; // +1 for header
      const cols = Math.max(t.headers.length, ...t.rows.map((r) => r.length));
      // Insert table at end-of-body
      await batchUpdate(token, documentId, [{
        insertTable: { location: { index: insertAt }, rows, columns: cols },
      }]);
      // Refetch to discover cell indices
      const doc2 = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
      const tableEl = findLastTable(doc2);
      if (!tableEl) continue;
      const fillReqs = fillTableRequests(tableEl, [t.headers, ...t.rows], cols);
      if (fillReqs.length) await batchUpdate(token, documentId, fillReqs);
      totalApplied += fillReqs.length + 1;
    }
  }

  return totalApplied;
}

// Find the most recently inserted table in the doc body.
function findLastTable(doc: AnyJson): AnyJson | null {
  const content = ((doc.body as AnyJson | undefined)?.content as AnyJson[]) || [];
  for (let i = content.length - 1; i >= 0; i--) {
    if ((content[i] as AnyJson).table) return content[i] as AnyJson;
  }
  return null;
}

// Build per-cell insertText + header-row styling. Walks cells in REVERSE
// so index shifts from earlier inserts don't invalidate later targets.
function fillTableRequests(tableEl: AnyJson, data: string[][], cols: number): DocReq[] {
  const table = tableEl.table as AnyJson;
  const rows = (table.tableRows as AnyJson[]) || [];
  const out: DocReq[] = [];

  type CellTarget = { rowIdx: number; colIdx: number; insertIndex: number; startIndex: number; endIndex: number };
  const targets: CellTarget[] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells = ((rows[r] as AnyJson).tableCells as AnyJson[]) || [];
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c] as AnyJson;
      const startIndex = cell.startIndex as number;
      const endIndex = cell.endIndex as number;
      // empty cell content begins just after startIndex (cell start marker)
      targets.push({ rowIdx: r, colIdx: c, insertIndex: startIndex + 1, startIndex, endIndex });
    }
  }

  // 1) Style header row (bg) — emit BEFORE inserts, doesn't change indices
  if (rows.length > 0) {
    const tableStart = tableEl.startIndex as number;
    out.push({
      updateTableCellStyle: {
        tableRange: {
          tableCellLocation: { tableStartLocation: { index: tableStart }, rowIndex: 0, columnIndex: 0 },
          rowSpan: 1,
          columnSpan: cols,
        },
        tableCellStyle: {
          backgroundColor: rgb(THEME.tableHeaderBg),
          paddingTop: pt(6), paddingBottom: pt(6), paddingLeft: pt(8), paddingRight: pt(8),
        },
        fields: "backgroundColor,paddingTop,paddingBottom,paddingLeft,paddingRight",
      },
    });
    // Padding on body rows
    if (rows.length > 1) {
      out.push({
        updateTableCellStyle: {
          tableRange: {
            tableCellLocation: { tableStartLocation: { index: tableStart }, rowIndex: 1, columnIndex: 0 },
            rowSpan: rows.length - 1,
            columnSpan: cols,
          },
          tableCellStyle: {
            paddingTop: pt(6), paddingBottom: pt(6), paddingLeft: pt(8), paddingRight: pt(8),
          },
          fields: "paddingTop,paddingBottom,paddingLeft,paddingRight",
        },
      });
    }
  }

  // 2) Insert text + style — REVERSE order so earlier indices stay valid
  const insertOps: DocReq[] = [];
  for (let r = targets.length - 1; r >= 0; r--) {
    const t = targets[r];
    const value = data[t.rowIdx]?.[t.colIdx] ?? "";
    if (!value) continue;
    insertOps.push({ insertText: { location: { index: t.insertIndex }, text: value } });
    // Style: baseline font + bold for header row
    const styleEnd = t.insertIndex + value.length;
    insertOps.push({
      updateTextStyle: {
        range: { startIndex: t.insertIndex, endIndex: styleEnd },
        textStyle: {
          weightedFontFamily: { fontFamily: THEME.fontBody },
          fontSize: pt(THEME.bodySize),
          bold: t.rowIdx === 0,
        },
        fields: "weightedFontFamily,fontSize,bold",
      },
    });
  }
  out.push(...insertOps);
  return out;
}

// ─────────────────────────────────────────────────────────────
// HTTP handler
// ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getAuthedUserId(req);
    const { action, params = {} } = (await req.json()) as { action: string; params?: AnyJson };
    if (!action) return jsonErr("Missing action");

    const token = await getGoogleAccessToken(userId);

    switch (action) {
      case "list_documents": {
        const pageSize = Number((params as AnyJson).pageSize || 25);
        const qs = new URLSearchParams();
        qs.set("q", "mimeType='application/vnd.google-apps.document' and trashed=false");
        qs.set("pageSize", String(Math.min(100, Math.max(1, pageSize))));
        qs.set("fields", "files(id,name,modifiedTime,webViewLink),nextPageToken");
        const data = await gFetch(token, `${DRIVE_BASE}/files?${qs.toString()}`);
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "get_document": {
        const documentId = String((params as AnyJson).documentId || "");
        if (!documentId) return jsonErr("documentId is required");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`);
        return jsonOk({ success: true, document: data });
      }

      case "create_document": {
        const title = String((params as AnyJson).title || "Untitled Document");
        const data = await gFetch(token, DOCS_BASE, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        return jsonOk({ success: true, document: data });
      }

      case "batch_update": {
        const documentId = String((params as AnyJson).documentId || "");
        const requests = (params as AnyJson).requests as AnyJson[] | undefined;
        if (!documentId || !requests) return jsonErr("documentId and requests are required");
        const data = await batchUpdate(token, documentId, requests);
        return jsonOk({ success: true, ...data });
      }

      case "insert_text": {
        const documentId = String((params as AnyJson).documentId || "");
        const text = String((params as AnyJson).text || "");
        const index = Number((params as AnyJson).index || 1);
        if (!documentId || !text) return jsonErr("documentId and text are required");
        const data = await batchUpdate(token, documentId, [{ insertText: { location: { index }, text } }]);
        return jsonOk({ success: true, ...data });
      }

      case "replace_text": {
        const documentId = String((params as AnyJson).documentId || "");
        const find = String((params as AnyJson).find || "");
        const replaceText = String((params as AnyJson).replaceText || "");
        if (!documentId || !find) return jsonErr("documentId and find are required");
        const data = await batchUpdate(token, documentId, [
          { replaceAllText: { containsText: { text: find, matchCase: true }, replaceText } },
        ]);
        return jsonOk({ success: true, ...data });
      }

      case "export_document": {
        const documentId = String((params as AnyJson).documentId || "");
        const mimeType = String((params as AnyJson).mimeType || "application/pdf");
        if (!documentId) return jsonErr("documentId is required");
        const res = await fetch(`${DRIVE_BASE}/files/${encodeURIComponent(documentId)}/export?mimeType=${encodeURIComponent(mimeType)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Docs export ${res.status}: ${await res.text()}`);
        return new Response(res.body, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": mimeType },
        });
      }

      case "apply_markdown": {
        const documentId = String((params as AnyJson).documentId || "");
        const markdown = String((params as AnyJson).markdown || "");
        const replaceAll = Boolean((params as AnyJson).replaceAll);
        if (!documentId || !markdown) return jsonErr("documentId and markdown are required");
        const applied = await renderMarkdownIntoDoc(token, documentId, markdown, replaceAll);
        return jsonOk({ success: true, applied_requests: applied });
      }

      case "apply_styled_document": {
        const p = params as AnyJson;
        const documentId = String(p.documentId || "");
        if (!documentId) return jsonErr("documentId is required");
        const replaceAll = p.replaceAll === false ? false : true;
        const title = String(p.title || "");
        const subtitle = p.subtitle ? String(p.subtitle) : "";
        const meta = (p.meta || {}) as { date?: string; for?: string; purpose?: string };
        const execSummary = p.executiveSummary ? String(p.executiveSummary) : "";
        const sections = (p.sections || []) as Array<{
          eyebrow?: string; heading: string; body?: string;
          table?: { headers: string[]; rows: string[][] }; callout?: string;
        }>;
        const recommendations = (p.recommendations || []) as string[];
        const closing = p.closing ? String(p.closing) : "";

        if (!title) return jsonErr("title is required");

        // Build a single markdown payload — renderer handles everything.
        const parts: string[] = [];
        parts.push(`# ${title}`);
        if (subtitle) parts.push(`*${subtitle}*`);
        const metaBits: string[] = [];
        if (meta.date) metaBits.push(`**Date:** ${meta.date}`);
        if (meta.for) metaBits.push(`**For:** ${meta.for}`);
        if (meta.purpose) metaBits.push(`**Purpose:** ${meta.purpose}`);
        if (metaBits.length) parts.push(metaBits.join(" · "));
        parts.push(""); // blank

        if (execSummary) {
          parts.push("## Executive Summary");
          parts.push(execSummary);
          parts.push("");
        }

        for (let idx = 0; idx < sections.length; idx++) {
          const s = sections[idx];
          if (idx > 0) parts.push("---");
          if (s.eyebrow) parts.push(`#### ${s.eyebrow}`);
          parts.push(`## ${s.heading}`);
          if (s.body) parts.push(s.body);
          if (s.table && s.table.headers?.length) {
            const headerRow = `| ${s.table.headers.join(" | ")} |`;
            const sepRow = `| ${s.table.headers.map(() => "---").join(" | ")} |`;
            const dataRows = (s.table.rows || []).map((r) => `| ${r.join(" | ")} |`);
            parts.push("");
            parts.push(headerRow);
            parts.push(sepRow);
            parts.push(...dataRows);
            parts.push("");
          }
          if (s.callout) parts.push(`> ${s.callout}`);
          parts.push("");
        }

        if (recommendations.length) {
          parts.push("---");
          parts.push("## Recommendations");
          recommendations.forEach((r, i) => parts.push(`${i + 1}. ${r}`));
          parts.push("");
        }

        if (closing) {
          parts.push("");
          parts.push(`*${closing}*`);
        }

        const markdown = parts.join("\n");
        const applied = await renderMarkdownIntoDoc(token, documentId, markdown, replaceAll);
        return jsonOk({ success: true, applied_requests: applied, sections: sections.length });
      }

      case "style_range": {
        const p = params as AnyJson;
        const documentId = String(p.documentId || "");
        const startIndex = Number(p.startIndex);
        const endIndex = Number(p.endIndex);
        if (!documentId || !Number.isFinite(startIndex) || !Number.isFinite(endIndex) || endIndex <= startIndex) {
          return jsonErr("documentId, startIndex, endIndex are required (endIndex > startIndex)");
        }
        const textStyle: AnyJson = {};
        const fields: string[] = [];
        if (typeof p.bold === "boolean") { textStyle.bold = p.bold; fields.push("bold"); }
        if (typeof p.italic === "boolean") { textStyle.italic = p.italic; fields.push("italic"); }
        if (typeof p.fontSize === "number") {
          textStyle.fontSize = pt(p.fontSize as number);
          fields.push("fontSize");
        }
        if (typeof p.foregroundColor === "string") {
          const rgbC = hexToRgb(p.foregroundColor as string);
          if (rgbC) { textStyle.foregroundColor = rgb(rgbC); fields.push("foregroundColor"); }
        }
        if (typeof p.link === "string" && p.link) {
          textStyle.link = { url: p.link };
          fields.push("link");
        }
        if (fields.length === 0) return jsonErr("At least one style field is required");
        const data = await batchUpdate(token, documentId, [{
          updateTextStyle: { range: { startIndex, endIndex }, textStyle, fields: fields.join(",") },
        }]);
        return jsonOk({ success: true, ...data });
      }

      case "format_as_report": {
        const documentId = String((params as AnyJson).documentId || "");
        if (!documentId) return jsonErr("documentId is required");

        const doc = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
        const end = getBodyEndIndex(doc);
        if (end <= 2) {
          // Empty doc — just set page margins.
          await batchUpdate(token, documentId, documentThemeRequests());
          return jsonOk({ success: true, message: "Applied page setup to empty document" });
        }

        const requests: DocReq[] = [];
        requests.push(...documentThemeRequests());
        requests.push(...baselineStyleRequests(1, end - 1));

        // Promote first non-empty paragraph to title styling
        const content = ((doc.body as AnyJson | undefined)?.content as AnyJson[]) || [];
        let firstPara: { start: number; end: number; text: string } | null = null;
        let secondPara: { start: number; end: number; text: string } | null = null;
        for (const el of content) {
          const para = (el as AnyJson).paragraph as AnyJson | undefined;
          if (!para) continue;
          const elements = (para.elements as AnyJson[]) || [];
          const text = elements.map((e) => ((e as AnyJson).textRun as AnyJson | undefined)?.content as string || "").join("");
          if (!text.trim()) continue;
          const entry = { start: (el as AnyJson).startIndex as number, end: (el as AnyJson).endIndex as number, text };
          if (!firstPara) firstPara = entry;
          else if (!secondPara) { secondPara = entry; break; }
        }

        if (firstPara) {
          requests.push({
            updateParagraphStyle: {
              range: { startIndex: firstPara.start, endIndex: firstPara.end },
              paragraphStyle: { namedStyleType: "HEADING_1", spaceBelow: pt(THEME.titleSpaceBelow), lineSpacing: 115 },
              fields: "namedStyleType,spaceBelow,lineSpacing",
            },
          });
          requests.push({
            updateTextStyle: {
              range: { startIndex: firstPara.start, endIndex: Math.max(firstPara.start + 1, firstPara.end - 1) },
              textStyle: { fontSize: pt(THEME.titleSize), bold: true, weightedFontFamily: { fontFamily: THEME.fontBody } },
              fields: "fontSize,bold,weightedFontFamily",
            },
          });
        }
        if (secondPara && secondPara.text.trim().length < 120) {
          requests.push({
            updateTextStyle: {
              range: { startIndex: secondPara.start, endIndex: Math.max(secondPara.start + 1, secondPara.end - 1) },
              textStyle: {
                fontSize: pt(THEME.subtitleSize), italic: true, foregroundColor: rgb(THEME.grayMid),
              },
              fields: "fontSize,italic,foregroundColor",
            },
          });
        }

        const data = await batchUpdate(token, documentId, requests);
        return jsonOk({ success: true, applied_requests: requests.length, ...data });
      }

      case "clear_formatting": {
        const documentId = String((params as AnyJson).documentId || "");
        if (!documentId) return jsonErr("documentId is required");
        const p = params as AnyJson;
        let startIndex = typeof p.startIndex === "number" ? p.startIndex : 1;
        let endIndex = typeof p.endIndex === "number" ? p.endIndex : 0;
        if (!endIndex) {
          const doc = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
          endIndex = Math.max(2, getBodyEndIndex(doc) - 1);
        }
        if (endIndex <= startIndex) return jsonOk({ success: true, message: "Empty range — nothing to clear" });
        const data = await batchUpdate(token, documentId, [
          {
            updateTextStyle: {
              range: { startIndex, endIndex },
              textStyle: {},
              fields: "bold,italic,underline,strikethrough,fontSize,weightedFontFamily,foregroundColor,backgroundColor,link",
            },
          },
          { updateParagraphStyle: { range: { startIndex, endIndex }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } },
          { deleteParagraphBullets: { range: { startIndex, endIndex } } },
        ]);
        return jsonOk({ success: true, ...data });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-docs] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
