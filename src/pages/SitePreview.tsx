import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Monitor, Smartphone, Check, Sparkles, Loader2, Link2 } from "lucide-react";

type Preview = { id: string; html: string; domain: string; business_name?: string | null; source_url?: string };

const STAGES = [
  "Reading your website",
  "Pulling out your brand, services and contact details",
  "Choosing a design direction",
  "Designing your new homepage",
  "Polishing the mobile layout",
  "Final touches",
];

export default function SitePreview() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [lead, setLead] = useState({ name: "", email: "", phone: "" });
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "See your next website | Ozlon";
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    supabase.functions.invoke("site-preview", { body: { action: "get", id } }).then(({ data }) => {
      if (data?.html) setPreview(data);
      else setError("That design couldn't be found.");
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!loading || id) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 18000);
    return () => clearInterval(t);
  }, [loading, id]);

  const generate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim() || loading) return;
    setError(null);
    setPreview(null);
    setClaimed(false);
    setLoading(true);
    const { data, error: err } = await supabase.functions.invoke("site-preview", { body: { url } });
    setLoading(false);
    if (data?.html) {
      setPreview(data);
      return;
    }
    let msg = data?.error as string | undefined;
    if (!msg && err && "context" in err) {
      try { msg = (await (err as any).context.json()).error; } catch { /* ignore */ }
    }
    setError(msg || "Something went wrong. Try again.");
  };

  const claim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    setClaiming(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("site-preview", {
      body: { action: "claim", id: preview.id, ...lead },
    });
    setClaiming(false);
    if (data?.ok) setClaimed(true);
    else {
      let msg = data?.error;
      if (!msg && err && "context" in err) {
        try { msg = (await (err as any).context.json()).error; } catch { /* ignore */ }
      }
      setError(msg || "Couldn't save. Try again.");
    }
  };

  const shareLink = useMemo(() => (preview ? `${window.location.origin}/preview/${preview.id}` : ""), [preview]);

  return (
    <div className="dark min-h-screen bg-background text-foreground relative overflow-hidden">
      {/* ambient grid + glow */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(hsl(var(--foreground))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--foreground))_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[520px] w-[900px] rounded-full bg-primary/25 blur-[140px]" />

      <div className={`relative mx-auto max-w-6xl px-4 ${embed ? "py-6" : "py-10 md:py-16"}`}>
        {!embed && (
          <a href="https://ozlon.net" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary))]" /> Ozlon
          </a>
        )}

        {!preview && (
          <section className="mt-10 md:mt-16 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> AI website studio
            </div>
            <h1 className="mt-6 text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
              See what your next
              <br />
              <span className="bg-gradient-to-r from-primary via-foreground to-primary bg-clip-text text-transparent">website looks like.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-muted-foreground md:text-lg">
              Enter your website. We read it, keep your brand and details, and design a new homepage for you. Free, in about two minutes.
            </p>

            <form onSubmit={generate} className="mx-auto mt-8 flex max-w-xl flex-col gap-2 sm:flex-row rounded-2xl border border-border/60 bg-card/50 p-2 backdrop-blur-xl shadow-[0_0_60px_-20px_hsl(var(--primary)/0.6)]">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yourbusiness.com"
                maxLength={300}
                disabled={loading}
                className="flex-1 bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground/60"
                aria-label="Your website address"
              />
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Design it <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>

            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

            {loading && !id && (
              <div className="mx-auto mt-10 max-w-md text-left rounded-2xl border border-border/60 bg-card/40 p-5 backdrop-blur-xl">
                <div className="relative h-1 overflow-hidden rounded-full bg-muted">
                  <div className="absolute inset-y-0 left-0 bg-primary transition-all duration-[18000ms] ease-linear" style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }} />
                </div>
                <ul className="mt-5 space-y-3">
                  {STAGES.map((s, i) => (
                    <li key={s} className={`flex items-center gap-3 text-sm transition-opacity ${i > stage ? "opacity-30" : "opacity-100"}`}>
                      {i < stage ? <Check className="h-4 w-4 text-primary" /> : i === stage ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <span className="h-4 w-4 rounded-full border border-border" />}
                      {s}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-xs text-muted-foreground">Keep this page open. It usually takes about two minutes.</p>
              </div>
            )}
            {loading && id && <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-primary" />}
          </section>
        )}

        {preview && (
          <section className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary">Your new homepage</p>
                <h2 className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight">{preview.business_name || preview.domain}</h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl border border-border/60 bg-card/40 p-1">
                  {(["desktop", "mobile"] as const).map((d) => (
                    <button key={d} onClick={() => setDevice(d)} aria-label={d}
                      className={`rounded-lg px-3 py-1.5 transition ${device === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      {d === "desktop" ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                    </button>
                  ))}
                </div>
                <button onClick={() => { navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-sm hover:bg-card/70">
                  <Link2 className="h-4 w-4" /> {copied ? "Copied" : "Share"}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
              <div className="flex justify-center rounded-2xl border border-border/60 bg-card/30 p-3 backdrop-blur-xl shadow-[0_0_80px_-30px_hsl(var(--primary)/0.7)]">
                <div className={`w-full overflow-hidden rounded-xl bg-background transition-all duration-500 ${device === "mobile" ? "max-w-[390px]" : ""}`}>
                  <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                    <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                    <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                    <span className="ml-3 truncate text-xs text-muted-foreground">{preview.domain}</span>
                  </div>
                  <iframe title="Website preview" srcDoc={preview.html} sandbox="" className="h-[70vh] w-full bg-background" />
                </div>
              </div>

              <aside className="rounded-2xl border border-border/60 bg-card/40 p-5 backdrop-blur-xl h-fit">
                {claimed ? (
                  <div>
                    <Check className="h-6 w-6 text-primary" />
                    <h3 className="mt-3 text-lg font-semibold">It's yours.</h3>
                    <p className="mt-2 text-sm text-muted-foreground">We'll reach out shortly to talk about making it live, with hosting, care and an AI receptionist so you never miss a call.</p>
                  </div>
                ) : (
                  <form onSubmit={claim} className="space-y-3">
                    <h3 className="text-lg font-semibold">Like it? Keep it.</h3>
                    <p className="text-sm text-muted-foreground">Leave your details and we'll save this design and show you how to make it live.</p>
                    {[
                      { k: "name", p: "Your name", t: "text", r: true },
                      { k: "email", p: "Email", t: "email", r: true },
                      { k: "phone", p: "Phone (optional)", t: "tel", r: false },
                    ].map((f) => (
                      <input key={f.k} type={f.t} required={f.r} placeholder={f.p} maxLength={f.k === "phone" ? 40 : 255}
                        value={(lead as any)[f.k]} onChange={(e) => setLead({ ...lead, [f.k]: e.target.value })}
                        className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-sm outline-none focus:border-primary" />
                    ))}
                    <button disabled={claiming} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                      {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Keep this design"}
                    </button>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                  </form>
                )}
                <button onClick={() => { setPreview(null); setUrl(""); window.history.replaceState(null, "", "/preview" + (embed ? "?embed=1" : "")); }}
                  className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground">Try another website</button>
              </aside>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
