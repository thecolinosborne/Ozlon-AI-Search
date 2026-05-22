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
    // Preserve link URLs: <a href="X">text</a> → text (X)
    .replace(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const t = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const h = String(href).trim();
      if (!h || h.startsWith("mailto:") || h.startsWith("#")) return t;
      return t && t !== h ? `${t} (${h})` : h;
    })
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

  // Harvest URLs from the HTML version so notification emails (Gemini,
  // Calendar, Meet, NotebookLM, etc.) don't lose their primary action link
  // when we fall back to the plain-text part.
  const harvestHrefs = (raw: string): string[] => {
    if (!raw) return [];
    const out = new Set<string>();
    const re = /href\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const h = m[1].trim();
      if (!h || h.startsWith("mailto:") || h.startsWith("#")) continue;
      // Prioritize notes / doc / meeting links — surface those first.
      out.add(h);
    }
    return Array.from(out);
  };

  if (plain) {
    const hrefs = harvestHrefs(html);
    const missing = hrefs.filter((u) => !plain.includes(u));
    if (missing.length) {
      const top = missing
        .filter((u) => /docs\.google\.com|gemini\.google\.com|notebooklm\.google\.com|meet\.google\.com|calendar\.google\.com|drive\.google\.com/i.test(u))
        .slice(0, 5);
      const rest = missing.filter((u) => !top.includes(u)).slice(0, 5);
      const all = [...top, ...rest];
      if (all.length) {
        return `${plain.trim()}\n\n[Links found in HTML body]\n${all.map((u) => `- ${u}`).join("\n")}`;
      }
    }
    return plain.trim();
  }
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
