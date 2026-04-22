// Reusable formatters — keep manifests declarative.
// Pattern: pick fields you want, hand to a formatter helper, get AI-friendly text.

const MAX_ITEMS_DEFAULT = 25;
const MAX_LINE_LEN = 240;

const truncate = (s: string, n = MAX_LINE_LEN): string =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

const get = (obj: unknown, path: string): unknown => {
  if (!obj || typeof obj !== "object") return undefined;
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
};

const stringify = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(stringify).filter(Boolean).join(", ");
  return JSON.stringify(v);
};

/** Render a list as bullet lines. Each item picks fields by path.
 *  Example:
 *    formatList(data, "contacts", { title: "name", sub: "email" })
 *    → "Found 3 contacts:\n• Jane — jane@x.com\n• …" */
export function formatList(
  data: unknown,
  arrayPath: string,
  fields: { title: string; sub?: string; meta?: string },
  opts: { label?: string; max?: number; emptyMessage?: string } = {},
): string {
  const items = get(data, arrayPath);
  if (!Array.isArray(items) || items.length === 0) {
    return opts.emptyMessage ?? `No ${opts.label ?? arrayPath} found.`;
  }
  const max = opts.max ?? MAX_ITEMS_DEFAULT;
  const shown = items.slice(0, max);
  const lines = shown.map((it) => {
    const title = stringify(get(it, fields.title)) || "(untitled)";
    const sub = fields.sub ? stringify(get(it, fields.sub)) : "";
    const meta = fields.meta ? stringify(get(it, fields.meta)) : "";
    let line = `• ${title}`;
    if (sub) line += ` — ${sub}`;
    if (meta) line += ` [${meta}]`;
    return truncate(line);
  });
  const header = `Found ${items.length} ${opts.label ?? arrayPath}${
    items.length > max ? ` (showing first ${max})` : ""
  }:`;
  return `${header}\n${lines.join("\n")}`;
}

/** Render key-value pairs (single-record summary). */
export function formatRecord(
  data: unknown,
  fields: Record<string, string>,
  opts: { label?: string } = {},
): string {
  const lines: string[] = [];
  for (const [label, path] of Object.entries(fields)) {
    const v = stringify(get(data, path));
    if (v) lines.push(`${label}: ${truncate(v)}`);
  }
  if (lines.length === 0) return JSON.stringify(data).slice(0, 1500);
  const header = opts.label ? `${opts.label}:\n` : "";
  return header + lines.join("\n");
}

/** One-line success/failure receipt — for write ops. */
export function formatReceipt(
  data: unknown,
  template: string, // e.g. "Created task {name} (id: {id})"
): string {
  return template.replace(/\{([^}]+)\}/g, (_, path) => stringify(get(data, path)) || "?");
}

/** Numeric/metric snapshot — picks numbers and renders one per line. */
export function formatMetrics(
  data: unknown,
  fields: Record<string, string>,
  opts: { label?: string } = {},
): string {
  const lines = Object.entries(fields)
    .map(([k, p]) => {
      const v = get(data, p);
      return typeof v === "number" ? `${k}: ${v.toLocaleString()}` : null;
    })
    .filter(Boolean) as string[];
  if (lines.length === 0) return JSON.stringify(data).slice(0, 1500);
  return (opts.label ? `${opts.label}\n` : "") + lines.join(" · ");
}
