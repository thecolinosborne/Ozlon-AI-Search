// Ozlon Browser add-on: runs assistant jobs in this Chrome with your permission.
const API = "https://iebmlegqknigeildujyp.supabase.co/functions/v1/local-browser";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllYm1sZWdxa25pZ2VpbGR1anlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2OTc3MDQsImV4cCI6MjA4MDI3MzcwNH0.Y4IBVXMoE_w6_reikXjFZXn86EOICng7xA_sv2rktwY";
let busy = false;

async function api(body) {
  const { token } = await chrome.storage.local.get("token");
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}`, ...(token ? { "x-device-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && body.action !== "pair_claim") await chrome.storage.local.remove("token");
  return d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setStatus = (text) => chrome.storage.local.set({ status: text, statusAt: Date.now() });

// ---------- Permissions: once / always this site / always everything
const pendingAsks = new Map();
async function ask(kind, info) {
  const { perms = { all: false, sites: {}, startAlways: false } } = await chrome.storage.local.get("perms");
  if (kind === "start" && perms.startAlways) return true;
  if (kind === "action" && (perms.all || perms.sites[info.host])) return true;
  const id = crypto.randomUUID();
  const q = new URLSearchParams({ id, kind, ...info });
  const win = await chrome.windows.create({ url: `permission.html?${q}`, type: "popup", width: 420, height: 380, focused: true });
  const answer = await new Promise((resolve) => {
    pendingAsks.set(id, resolve);
    const onClose = (wid) => { if (wid === win.id) { chrome.windows.onRemoved.removeListener(onClose); if (pendingAsks.has(id)) { pendingAsks.delete(id); resolve("deny"); } } };
    chrome.windows.onRemoved.addListener(onClose);
  });
  if (answer === "deny") return false;
  if (answer === "site") perms.sites[info.host] = true;
  if (answer === "all") { if (kind === "start") perms.startAlways = true; else perms.all = true; }
  await chrome.storage.local.set({ perms });
  return true;
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "perm" && pendingAsks.has(msg.id)) { pendingAsks.get(msg.id)(msg.answer); pendingAsks.delete(msg.id); }
  if (msg.type === "pair") { api({ action: "pair_claim", code: msg.code, label: "Chrome" }).then(async (d) => { if (d.success) { await chrome.storage.local.set({ token: d.token }); tick(); } reply(d); }); return true; }
  if (msg.type === "unpair") { chrome.storage.local.remove("token").then(() => reply({ ok: true })); return true; }
});

// ---------- Page helpers (run inside the tab)
function snapshotFn() {
  document.querySelectorAll("[data-oz]").forEach((e) => e.removeAttribute("data-oz"));
  const sel = "a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=true],summary";
  const out = []; let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none" || el.type === "hidden") continue;
    if (r.bottom < -200 || r.top > innerHeight * 3) continue;
    i++; el.setAttribute("data-oz", String(i));
    out.push({ i, tag: el.tagName.toLowerCase(), type: el.type || "", text: (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").trim().replace(/\s+/g, " ").slice(0, 80),
      name: (el.name || el.id || "").slice(0, 40), placeholder: (el.placeholder || "").slice(0, 60), label: (el.labels && el.labels[0] ? el.labels[0].innerText : el.getAttribute("aria-label") || "").trim().slice(0, 60),
      href: el.href ? String(el.href).slice(0, 160) : "", autocomplete: el.getAttribute("autocomplete") || "" });
    if (out.length >= 150) break;
  }
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").slice(0, 7000), elements: out };
}

function actFn(a) {
  const el = a.id ? document.querySelector(`[data-oz="${a.id}"]`) : null;
  if (a.type === "scroll") { scrollBy(0, (a.direction === "up" ? -1 : 1) * innerHeight * 0.8); return { ok: true }; }
  if (a.type === "back") { history.back(); return { ok: true }; }
  if (!el) return { ok: false, note: "Element not found" };
  el.scrollIntoView({ block: "center" });
  el.style.outline = "3px solid #7c9cff";
  if (a.type === "click") { el.click(); return { ok: true }; }
  if (a.type === "type") {
    if (el.type === "password") return { ok: false, note: "Will not type passwords" };
    el.focus();
    if (el.isContentEditable) { document.execCommand("selectAll"); document.execCommand("insertText", false, a.text || ""); }
    else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, a.text || "");
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (a.submit) { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true })); if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); }
    return { ok: true };
  }
  if (a.type === "select") {
    const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === String(a.value).toLowerCase()) || [...el.options].find((o) => o.text.toLowerCase().includes(String(a.value).toLowerCase()));
    if (!opt) return { ok: false, note: "Option not found" };
    el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true })); return { ok: true };
  }
  return { ok: false, note: "Unknown action" };
}

async function waitLoaded(tabId) {
  for (let i = 0; i < 40; i++) { const t = await chrome.tabs.get(tabId).catch(() => null); if (!t) return; if (t.status === "complete") break; await sleep(400); }
  await sleep(600);
}

async function run(task) {
  const tabKey = `tab_${task.id}`;
  let { [tabKey]: tabId } = await chrome.storage.local.get(tabKey);
  if (!tabId || !(await chrome.tabs.get(tabId).catch(() => null))) {
    if (!(await ask("start", { goal: task.goal.slice(0, 300) }))) {
      await api({ action: "step", task_id: task.id, snapshot: { url: "", title: "", text: "Colin declined to let the assistant use his browser.", elements: [] }, last: { ok: false, note: "Declined" } });
      return;
    }
    const tab = await chrome.tabs.create({ url: task.start_url || "about:blank", active: true });
    tabId = tab.id; await chrome.storage.local.set({ [tabKey]: tabId });
    await waitLoaded(tabId);
  }
  let last = null;
  for (let n = 0; n < 80; n++) {
    let snap = { url: "", title: "", text: "", elements: [] };
    try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: snapshotFn }); snap = r.result || snap; } catch { /* chrome:// or blank page */ const t = await chrome.tabs.get(tabId).catch(() => null); if (!t) return; snap.url = t.url || ""; }
    const d = await api({ action: "step", task_id: task.id, snapshot: snap, last });
    if (!d.success || !d.action) { await sleep(2000); continue; }
    const a = d.action;
    if (d.say) setStatus(d.say);
    if (["stop", "done", "fail", "ask_user"].includes(a.type)) { setStatus(a.type === "done" ? "Done" : a.type === "ask_user" ? "Waiting on you in Ozlon" : "Stopped"); return; }
    if (d.permission && !(await ask("action", d.permission))) { last = { ok: false, note: "Colin declined this click. Do not try it again; find another way or finish." }; continue; }
    try {
      if (a.type === "goto") { await chrome.tabs.update(tabId, { url: a.url }); await waitLoaded(tabId); last = { ok: true }; }
      else if (a.type === "wait") { await sleep(Math.min(10, a.seconds || 1) * 1000); last = { ok: true }; }
      else {
        const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: actFn, args: [a] });
        last = r.result || { ok: false, note: "No result" };
        await sleep(900); await waitLoaded(tabId);
      }
    } catch (e) { last = { ok: false, note: String(e.message || e).slice(0, 150) }; }
  }
}

async function tick() {
  if (busy) return;
  const { token } = await chrome.storage.local.get("token");
  if (!token) return;
  busy = true;
  try {
    for (let i = 0; i < 6; i++) {
      const d = await api({ action: "heartbeat" });
      if (d.task) { setStatus("Working: " + d.task.goal.slice(0, 60)); await run(d.task); }
      else await sleep(9000);
    }
  } catch (e) { console.warn(e); }
  finally { busy = false; }
}

chrome.alarms.create("hb", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => tick());
chrome.runtime.onStartup.addListener(() => tick());
chrome.runtime.onInstalled.addListener(() => tick());
