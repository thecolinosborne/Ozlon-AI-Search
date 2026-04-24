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

// ─────────────────────────────────────────────────────────────
// Markdown → Google Docs requests builder
// Supports: # / ## / ### headings, **bold**, *italic*, `code`,
// - / * bullet lists, 1. numbered lists, blank-line paragraphs.
// ─────────────────────────────────────────────────────────────
type DocReq = AnyJson;

function buildMarkdownRequests(markdown: string, startIndex: number): { requests: DocReq[]; endIndex: number } {
  const requests: DocReq[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  type Block = { text: string; style: "HEADING_1" | "HEADING_2" | "HEADING_3" | "NORMAL_TEXT"; bullet?: "UNORDERED" | "ORDERED" };
  const blocks: Block[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { blocks.push({ text: "", style: "NORMAL_TEXT" }); continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)$/))) { blocks.push({ text: m[1], style: "HEADING_3" }); continue; }
    if ((m = line.match(/^##\s+(.*)$/)))  { blocks.push({ text: m[1], style: "HEADING_2" }); continue; }
    if ((m = line.match(/^#\s+(.*)$/)))   { blocks.push({ text: m[1], style: "HEADING_1" }); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { blocks.push({ text: m[1], style: "NORMAL_TEXT", bullet: "UNORDERED" }); continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { blocks.push({ text: m[1], style: "NORMAL_TEXT", bullet: "ORDERED" }); continue; }
    blocks.push({ text: line, style: "NORMAL_TEXT" });
  }

  // Build a flat plain-text body (with inline markers stripped) and remember per-block ranges + inline style spans.
  type InlineSpan = { start: number; end: number; bold?: boolean; italic?: boolean; code?: boolean };
  const blockRanges: { start: number; end: number; style: Block["style"]; bullet?: Block["bullet"] }[] = [];
  const inlineSpans: InlineSpan[] = [];
  let cursor = startIndex;
  let fullText = "";

  for (const b of blocks) {
    const blockStart = cursor;
    // Parse inline markers in b.text
    const segments: { text: string; bold?: boolean; italic?: boolean; code?: boolean }[] = [];
    const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
    let lastIdx = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(b.text)) !== null) {
      if (mm.index > lastIdx) segments.push({ text: b.text.slice(lastIdx, mm.index) });
      if (mm[2]) segments.push({ text: mm[2], bold: true });
      else if (mm[4]) segments.push({ text: mm[4], italic: true });
      else if (mm[6]) segments.push({ text: mm[6], code: true });
      lastIdx = mm.index + mm[0].length;
    }
    if (lastIdx < b.text.length) segments.push({ text: b.text.slice(lastIdx) });

    let lineText = "";
    for (const seg of segments) {
      const segStart = cursor + lineText.length;
      lineText += seg.text;
      const segEnd = cursor + lineText.length;
      if (seg.bold || seg.italic || seg.code) {
        inlineSpans.push({ start: segStart, end: segEnd, bold: seg.bold, italic: seg.italic, code: seg.code });
      }
    }
    lineText += "\n";
    fullText += lineText;
    cursor += lineText.length;
    blockRanges.push({ start: blockStart, end: cursor, style: b.style, bullet: b.bullet });
  }

  if (fullText.length === 0) return { requests: [], endIndex: startIndex };

  // 1) Insert all text in one request
  requests.push({ insertText: { location: { index: startIndex }, text: fullText } });

  // 2) Apply paragraph styles per block (heading vs normal)
  for (const br of blockRanges) {
    if (br.end <= br.start) continue;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: br.start, endIndex: br.end },
        paragraphStyle: { namedStyleType: br.style },
        fields: "namedStyleType",
      },
    });
  }

  // 3) Apply bullets — group consecutive bullet blocks of same kind
  let i = 0;
  while (i < blockRanges.length) {
    const br = blockRanges[i];
    if (!br.bullet) { i++; continue; }
    let j = i;
    while (j + 1 < blockRanges.length && blockRanges[j + 1].bullet === br.bullet) j++;
    const groupStart = blockRanges[i].start;
    const groupEnd = blockRanges[j].end;
    requests.push({
      createParagraphBullets: {
        range: { startIndex: groupStart, endIndex: groupEnd },
        bulletPreset: br.bullet === "ORDERED" ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
    i = j + 1;
  }

  // 4) Inline text styles
  for (const span of inlineSpans) {
    if (span.end <= span.start) continue;
    const textStyle: AnyJson = {};
    const fields: string[] = [];
    if (span.bold) { textStyle.bold = true; fields.push("bold"); }
    if (span.italic) { textStyle.italic = true; fields.push("italic"); }
    if (span.code) {
      textStyle.weightedFontFamily = { fontFamily: "Roboto Mono" };
      textStyle.backgroundColor = { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } } };
      fields.push("weightedFontFamily", "backgroundColor");
    }
    requests.push({
      updateTextStyle: {
        range: { startIndex: span.start, endIndex: span.end },
        textStyle,
        fields: fields.join(","),
      },
    });
  }

  return { requests, endIndex: cursor };
}

// Extract the end index of the doc body (for append/replaceAll)
function getBodyEndIndex(doc: AnyJson): number {
  const body = (doc as AnyJson).body as AnyJson | undefined;
  const content = (body?.content as AnyJson[]) || [];
  let end = 1;
  for (const el of content) {
    const ei = (el as AnyJson).endIndex as number | undefined;
    if (typeof ei === "number" && ei > end) end = ei;
  }
  // The body always ends with a trailing newline; safe insert/replace target is end - 1
  return end;
}

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
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "insert_text": {
        const documentId = String((params as AnyJson).documentId || "");
        const text = String((params as AnyJson).text || "");
        const index = Number((params as AnyJson).index || 1);
        if (!documentId || !text) return jsonErr("documentId and text are required");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{ insertText: { location: { index }, text } }],
          }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "replace_text": {
        const documentId = String((params as AnyJson).documentId || "");
        const find = String((params as AnyJson).find || "");
        const replaceText = String((params as AnyJson).replaceText || "");
        if (!documentId || !find) return jsonErr("documentId and find are required");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText } }],
          }),
        });
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

      // ──────────────────────────────────────────────────────
      // NEW: high-level styling tools
      // ──────────────────────────────────────────────────────
      case "apply_markdown": {
        const documentId = String((params as AnyJson).documentId || "");
        const markdown = String((params as AnyJson).markdown || "");
        const replaceAll = Boolean((params as AnyJson).replaceAll);
        if (!documentId || !markdown) return jsonErr("documentId and markdown are required");

        const requests: DocReq[] = [];
        let insertAt = 1;

        if (replaceAll) {
          // Wipe existing body (everything between index 1 and end - 1)
          const doc = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
          const end = getBodyEndIndex(doc);
          if (end > 2) {
            requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } });
          }
          insertAt = 1;
        } else {
          const doc = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
          const end = getBodyEndIndex(doc);
          insertAt = Math.max(1, end - 1);
        }

        const built = buildMarkdownRequests(markdown, insertAt);
        requests.push(...built.requests);

        if (requests.length === 0) return jsonOk({ success: true, message: "Nothing to apply" });
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
        return jsonOk({ success: true, applied_requests: requests.length, ...data });
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
          textStyle.fontSize = { magnitude: p.fontSize, unit: "PT" };
          fields.push("fontSize");
        }
        if (typeof p.foregroundColor === "string") {
          // Expect "#RRGGBB"
          const hex = (p.foregroundColor as string).replace("#", "");
          if (hex.length === 6) {
            const r = parseInt(hex.slice(0, 2), 16) / 255;
            const g = parseInt(hex.slice(2, 4), 16) / 255;
            const b = parseInt(hex.slice(4, 6), 16) / 255;
            textStyle.foregroundColor = { color: { rgbColor: { red: r, green: g, blue: b } } };
            fields.push("foregroundColor");
          }
        }
        if (typeof p.link === "string" && p.link) {
          textStyle.link = { url: p.link };
          fields.push("link");
        }
        if (fields.length === 0) return jsonErr("At least one style field is required (bold, italic, fontSize, foregroundColor, link)");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{
              updateTextStyle: {
                range: { startIndex, endIndex },
                textStyle,
                fields: fields.join(","),
              },
            }],
          }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "format_as_report": {
        const documentId = String((params as AnyJson).documentId || "");
        if (!documentId) return jsonErr("documentId is required");

        const doc = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`) as AnyJson;
        const end = getBodyEndIndex(doc);
        if (end <= 2) return jsonOk({ success: true, message: "Document is empty — nothing to format" });

        const requests: DocReq[] = [];

        // 1) Apply Inter/Arial body font and 11pt baseline to whole body
        requests.push({
          updateTextStyle: {
            range: { startIndex: 1, endIndex: end - 1 },
            textStyle: {
              weightedFontFamily: { fontFamily: "Arial" },
              fontSize: { magnitude: 11, unit: "PT" },
            },
            fields: "weightedFontFamily,fontSize",
          },
        });

        // 2) Line spacing 1.15, small space below paragraphs
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: 1, endIndex: end - 1 },
            paragraphStyle: {
              lineSpacing: 115,
              spaceAbove: { magnitude: 0, unit: "PT" },
              spaceBelow: { magnitude: 6, unit: "PT" },
            },
            fields: "lineSpacing,spaceAbove,spaceBelow",
          },
        });

        // 3) Promote first non-empty paragraph to HEADING_1 + 24pt
        const body = (doc as AnyJson).body as AnyJson | undefined;
        const content = (body?.content as AnyJson[]) || [];
        let firstParaStart: number | null = null;
        let firstParaEnd: number | null = null;
        for (const el of content) {
          const para = (el as AnyJson).paragraph as AnyJson | undefined;
          if (!para) continue;
          const elements = (para.elements as AnyJson[]) || [];
          const text = elements.map((e) => ((e as AnyJson).textRun as AnyJson | undefined)?.content as string || "").join("");
          if (text.trim().length > 0) {
            firstParaStart = (el as AnyJson).startIndex as number;
            firstParaEnd = (el as AnyJson).endIndex as number;
            break;
          }
        }
        if (firstParaStart !== null && firstParaEnd !== null) {
          requests.push({
            updateParagraphStyle: {
              range: { startIndex: firstParaStart, endIndex: firstParaEnd },
              paragraphStyle: { namedStyleType: "HEADING_1" },
              fields: "namedStyleType",
            },
          });
          requests.push({
            updateTextStyle: {
              range: { startIndex: firstParaStart, endIndex: Math.max(firstParaStart + 1, firstParaEnd - 1) },
              textStyle: {
                fontSize: { magnitude: 24, unit: "PT" },
                bold: true,
              },
              fields: "fontSize,bold",
            },
          });
        }

        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
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
        const requests: DocReq[] = [
          {
            updateTextStyle: {
              range: { startIndex, endIndex },
              textStyle: {},
              fields: "bold,italic,underline,strikethrough,fontSize,weightedFontFamily,foregroundColor,backgroundColor,link",
            },
          },
          {
            updateParagraphStyle: {
              range: { startIndex, endIndex },
              paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
              fields: "namedStyleType",
            },
          },
          {
            deleteParagraphBullets: { range: { startIndex, endIndex } },
          },
        ];
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
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
