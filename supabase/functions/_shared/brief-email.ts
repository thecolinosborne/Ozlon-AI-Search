// Emails the daily brief to the user from their own connected Gmail.
import { getGoogleAccessToken } from "./google-token.ts";

type Item = { title?: string; detail?: string; urgency?: string; severity?: string; est_minutes?: number };
type Ev = { summary?: string; start?: string | null; all_day?: boolean; location?: string | null };

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const hdr = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");

function timeLabel(e: Ev, tz: string) {
  if (e.all_day || !e.start) return "All day";
  return new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

export function renderBrief(opts: {
  name?: string | null;
  nowLine: string;
  todos: Item[];
  watchouts: Item[];
  events: Ev[];
  appUrl: string;
  tz?: string;
}) {
  const tz = opts.tz || "America/New_York";
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz });
  const events = opts.events.slice(0, 10);
  const todos = opts.todos.slice(0, 8);
  const watch = opts.watchouts.slice(0, 6);

  const text = [
    `Good morning${opts.name ? `, ${opts.name}` : ""}. ${dateLabel}`,
    "",
    opts.nowLine,
    "",
    "SCHEDULE",
    ...(events.length ? events.map((e) => `- ${timeLabel(e, tz)}  ${e.summary ?? "Untitled"}`) : ["- Nothing on the calendar"]),
    "",
    "TO DO",
    ...(todos.length ? todos.map((t) => `- ${t.title}${t.detail ? ` — ${t.detail}` : ""}`) : ["- Nothing pressing"]),
    "",
    "WATCH OUT",
    ...(watch.length ? watch.map((w) => `- ${w.title}${w.detail ? ` — ${w.detail}` : ""}`) : ["- All clear"]),
    "",
    `Open your day: ${opts.appUrl}/signals`,
  ].join("\n");

  const li = (title: string, detail?: string, tag?: string) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #eef0f3">
      <div style="font-size:15px;color:#111827;font-weight:600">${esc(title)}${tag ? ` <span style="font-size:11px;color:#6b7280;font-weight:500;text-transform:uppercase;letter-spacing:.04em">${esc(tag)}</span>` : ""}</div>
      ${detail ? `<div style="font-size:13px;color:#6b7280;margin-top:3px">${esc(detail)}</div>` : ""}
    </td></tr>`;
  const section = (label: string, rows: string, empty: string) =>
    `<div style="margin-top:28px"><div style="font-size:11px;letter-spacing:.12em;color:#9ca3af;font-weight:600">${label}</div>
     <table width="100%" cellpadding="0" cellspacing="0">${rows || li(empty)}</table></div>`;

  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;color:#9ca3af">${esc(dateLabel)}</div>
    <h1 style="font-size:24px;color:#111827;margin:6px 0 12px;font-weight:600">Good morning${opts.name ? `, ${esc(opts.name)}` : ""}</h1>
    <p style="font-size:16px;color:#374151;line-height:1.5;margin:0">${esc(opts.nowLine)}</p>
    ${section("SCHEDULE", events.map((e) => li(e.summary ?? "Untitled", e.location ?? undefined, timeLabel(e, tz))).join(""), "Nothing on the calendar")}
    ${section("TO DO", todos.map((t) => li(t.title ?? "", t.detail, t.est_minutes ? `${t.est_minutes} min` : undefined)).join(""), "Nothing pressing")}
    ${section("WATCH OUT", watch.map((w) => li(w.title ?? "", w.detail)).join(""), "All clear")}
    <div style="margin-top:32px"><a href="${esc(opts.appUrl)}/signals" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600">Open your day</a></div>
    <p style="font-size:12px;color:#9ca3af;margin-top:28px">Your daily brief from Ozlon.</p>
  </div></body></html>`;

  return { subject: `Your brief for ${dateLabel}`, text, html };
}

export async function sendBriefEmail(userId: string, to: string, msg: { subject: string; text: string; html: string }) {
  const token = await getGoogleAccessToken(userId);
  if (!token) throw new Error("Google is not connected");
  const boundary = `=_brief_${crypto.randomUUID()}`;
  const raw = [
    `To: ${to}`,
    `Subject: ${hdr(msg.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(msg.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(msg.html)),
    `--${boundary}--`,
  ].join("\r\n");
  const encoded = b64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) throw new Error(`Gmail send failed [${res.status}]: ${await res.text()}`);
  return await res.json();
}
