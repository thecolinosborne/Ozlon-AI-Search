// Universal content extractors used by the chat layer and analyze tool.
// Pure functions — no I/O — so they can be unit-tested cheaply.

export function base64UrlDecode(data: string): string {
  try {
    const std = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
    return atob(padded);
  } catch {
    return "";
  }
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface MimePart {
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  filename?: string;
  parts?: MimePart[];
}

/** Walk a Gmail message payload (multipart/alternative + multipart/mixed) and return clean text. */
export function extractEmailBody(payload: MimePart | undefined | null): string {
  if (!payload) return "";
  let plain = "";
  let html = "";
  const walk = (p: MimePart | undefined) => {
    if (!p) return;
    const mt = (p.mimeType || "").toLowerCase();
    if (mt === "text/plain" && p.body?.data && !plain) plain = base64UrlDecode(p.body.data);
    else if (mt === "text/html" && p.body?.data && !html) html = base64UrlDecode(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain) return plain.trim();
  if (html) return stripHtml(html);
  return "";
}

interface DocsElement {
  textRun?: { content?: string };
  paragraph?: { elements?: DocsElement[] };
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: DocsElement[] }> }> };
}

/** Flatten Google Docs `document.body.content` to plain text. */
export function extractDocsText(doc: { body?: { content?: DocsElement[] }; title?: string } | null | undefined): string {
  if (!doc?.body?.content) return "";
  const lines: string[] = [];
  if (doc.title) lines.push(`# ${doc.title}\n`);
  const walk = (els: DocsElement[] | undefined) => {
    (els || []).forEach((el) => {
      if (el.textRun?.content) lines.push(el.textRun.content);
      if (el.paragraph?.elements) walk(el.paragraph.elements);
      el.table?.tableRows?.forEach((row) => {
        const cells = (row.tableCells || []).map((c) => {
          const buf: string[] = [];
          (c.content || []).forEach((cel) => {
            if (cel.paragraph?.elements) {
              cel.paragraph.elements.forEach((e) => { if (e.textRun?.content) buf.push(e.textRun.content.trim()); });
            }
          });
          return buf.join(" ");
        });
        lines.push(cells.join(" | ") + "\n");
      });
    });
  };
  walk(doc.body.content);
  return lines.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** Render a Sheets values array as a pipe-delimited table for AI consumption. */
export function extractSheetGrid(values: unknown): string {
  if (!Array.isArray(values) || values.length === 0) return "(empty range)";
  const rows = values as unknown[][];
  return rows.map((r) => r.map((c) => (c == null ? "" : String(c))).join(" | ")).join("\n");
}

/** Truncate with a clear marker so the model knows content was cut. */
export function clip(text: string, max = 12000): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n[...truncated ${text.length - max} chars]`;
}
