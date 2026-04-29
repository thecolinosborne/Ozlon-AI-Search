import { useState, useRef, useCallback } from "react";
import { Upload, Sparkles, FileText, Loader2, CheckCircle2, AlertTriangle, ShieldAlert, Wand2, FolderOpen, X } from "lucide-react";
import JSZip from "jszip";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type IngestFile = { path: string; content: string; encoding?: "utf8" | "base64" };

type Severity = "info" | "warn" | "block";
interface ScanFinding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  field?: string;
  autofixed?: boolean;
}
interface ScanReport {
  verdict: "safe" | "needs_review" | "blocked";
  score: number;
  findings: ScanFinding[];
  autofixes_applied: string[];
  external_urls: string[];
}
interface IngestResult {
  ok?: boolean;
  installed?: { id: string; slug: string } | null;
  manifest?: Record<string, unknown>;
  scan?: ScanReport;
  format?: string;
  reason?: string;
  error?: string;
  message?: string;
}

const MAX_FILES = 50;
const MAX_TOTAL = 5_000_000;
const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|skill|mdx)$/i;

function isProbablyText(name: string) {
  return TEXT_EXT.test(name);
}

async function fileToIngest(file: File, basePath = ""): Promise<IngestFile> {
  const path = basePath ? `${basePath}/${file.name}` : file.name;
  if (isProbablyText(file.name)) {
    return { path, content: await file.text(), encoding: "utf8" };
  }
  // base64 for binary
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return { path, content: btoa(binary), encoding: "base64" };
}

async function unpackZip(file: File): Promise<IngestFile[]> {
  const zip = await JSZip.loadAsync(file);
  const out: IngestFile[] = [];
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const isText = isProbablyText(entry.name);
    if (isText) {
      out.push({ path: entry.name, content: await entry.async("text"), encoding: "utf8" });
    } else {
      const b64 = await entry.async("base64");
      out.push({ path: entry.name, content: b64, encoding: "base64" });
    }
  }
  return out;
}

// Recursively walk a DataTransferItem.webkitGetAsEntry() tree
async function readEntry(entry: any, basePath = ""): Promise<IngestFile[]> {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise<IngestFile[]>((resolve) => {
      entry.file(async (f: File) => resolve([await fileToIngest(f, basePath)]));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    return new Promise<IngestFile[]>((resolve) => {
      reader.readEntries(async (entries: any[]) => {
        const all: IngestFile[] = [];
        for (const child of entries) {
          const sub = await readEntry(child, basePath ? `${basePath}/${entry.name}` : entry.name);
          all.push(...sub);
          if (all.length >= MAX_FILES) break;
        }
        resolve(all);
      });
    });
  }
  return [];
}

interface SkillDropzoneProps {
  onInstalled?: () => void;
}

export function SkillDropzone({ onInstalled }: SkillDropzoneProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [pendingFiles, setPendingFiles] = useState<IngestFile[]>([]);

  const reset = () => {
    setResult(null);
    setPendingFiles([]);
    setPrompt("");
  };

  const ingest = useCallback(async (
    payload: { files?: IngestFile[]; prompt?: string; force?: boolean }
  ) => {
    setBusy("Adapting…");
    setResult(null);
    try {
      // Tiny UX delay between phases so progress is visible
      const phases = ["Adapting…", "Normalizing…", "Scanning…", "Installing…"];
      let phaseIdx = 0;
      const phaseTimer = setInterval(() => {
        phaseIdx = Math.min(phaseIdx + 1, phases.length - 1);
        setBusy(phases[phaseIdx]);
      }, 1200);

      const { data, error } = await supabase.functions.invoke("skills-ingest", {
        body: { ...payload, install: true },
      });
      clearInterval(phaseTimer);

      if (error) throw error;
      const r = data as IngestResult;
      setResult(r);

      if (r.installed) {
        toast({ title: "Skill installed", description: r.installed.slug });
        onInstalled?.();
      } else if (r.scan?.verdict === "blocked") {
        toast({
          title: "Skill blocked by safety scan",
          description: `${r.scan.findings.filter(f => f.severity === "block").length} blocking issue(s)`,
          variant: "destructive",
        });
      } else if (r.scan?.verdict === "needs_review") {
        toast({ title: "Review required", description: "Resolve warnings or click Install anyway." });
      } else if (r.error) {
        toast({ title: "Couldn't ingest skill", description: r.message ?? r.error, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: "Ingest failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [onInstalled]);

  const handleFiles = useCallback(async (files: IngestFile[]) => {
    if (files.length === 0) return;
    if (files.length > MAX_FILES) {
      toast({ title: "Too many files", description: `Max ${MAX_FILES}`, variant: "destructive" });
      return;
    }
    const total = files.reduce((s, f) => s + f.content.length, 0);
    if (total > MAX_TOTAL) {
      toast({ title: "Bundle too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    setPendingFiles(files);
    await ingest({ files });
  }, [ingest]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items);
    const collected: IngestFile[] = [];

    // Try entries first (folder support)
    const entries = items.map((it) => (it as any).webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length > 0) {
      for (const entry of entries) {
        const sub = await readEntry(entry);
        collected.push(...sub);
        if (collected.length >= MAX_FILES) break;
      }
    } else {
      for (const f of Array.from(e.dataTransfer.files)) {
        if (f.name.toLowerCase().endsWith(".zip")) {
          collected.push(...(await unpackZip(f)));
        } else {
          collected.push(await fileToIngest(f));
        }
      }
    }

    // If a single file is a zip, unpack
    if (collected.length === 1 && collected[0].path.toLowerCase().endsWith(".zip")) {
      // shouldn't happen because we unpack above, but defensive
    }

    handleFiles(collected);
  }, [handleFiles]);

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const collected: IngestFile[] = [];
    for (const f of files) {
      if (f.name.toLowerCase().endsWith(".zip")) {
        collected.push(...(await unpackZip(f)));
      } else {
        // Folder uploads use webkitRelativePath
        const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
        const base = relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
        collected.push(await fileToIngest(f, base));
      }
    }
    e.target.value = "";
    handleFiles(collected);
  };

  const submitPrompt = () => {
    if (!prompt.trim()) return;
    ingest({ prompt: prompt.trim() });
  };

  const installAnyway = () => {
    ingest({ files: pendingFiles.length ? pendingFiles : undefined, prompt: prompt || undefined, force: true });
  };

  return (
    <div className="space-y-4">
      <Card
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "p-8 border-dashed border-2 transition-all",
          dragOver ? "border-primary bg-primary/5" : "border-border",
          busy && "opacity-70 pointer-events-none"
        )}
      >
        <div className="text-center space-y-4">
          <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-primary/10">
            {busy ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : <Sparkles className="w-5 h-5 text-primary" />}
          </div>
          <div>
            <h2 className="text-base font-medium">{busy ?? "Drop a skill, folder, or zip"}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Accepts SKILL.md, .json manifests, .yaml, folders, or .zip — Ozlon will figure out the rest.
            </p>
          </div>
          <div className="flex justify-center gap-2 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".json,.md,.yaml,.yml,.zip,.skill,.txt,.mdx"
              className="hidden"
              onChange={onFileInput}
            />
            <input
              ref={folderRef}
              type="file"
              {...({ webkitdirectory: "" } as any)}
              multiple
              className="hidden"
              onChange={onFileInput}
            />
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              Choose files
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => folderRef.current?.click()}>
              <FolderOpen className="w-4 h-4 mr-2" />
              Choose folder
            </Button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-border/50">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 text-center">
            or describe a skill in your own words
          </p>
          <Textarea
            placeholder="A skill that drafts a polite follow-up email if I haven't heard back in 5 days…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!!busy}
            rows={2}
            className="resize-none"
          />
          <div className="flex justify-end mt-2">
            <Button size="sm" disabled={!prompt.trim() || !!busy} onClick={submitPrompt}>
              <Wand2 className="w-4 h-4 mr-2" />
              Generate skill
            </Button>
          </div>
        </div>
      </Card>

      {result && <ScanReportCard result={result} onDismiss={reset} onForceInstall={installAnyway} />}
    </div>
  );
}

function ScanReportCard({
  result,
  onDismiss,
  onForceInstall,
}: {
  result: IngestResult;
  onDismiss: () => void;
  onForceInstall: () => void;
}) {
  const scan = result.scan;
  const m = result.manifest as { name?: string; slug?: string; description?: string; tools_required?: string[] } | undefined;

  if (result.error && !scan) {
    return (
      <Card className="p-5 border-destructive/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
          <div className="flex-1">
            <h3 className="font-medium">Couldn't ingest skill</h3>
            <p className="text-sm text-muted-foreground mt-1">{result.message ?? result.error}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onDismiss}><X className="w-4 h-4" /></Button>
        </div>
      </Card>
    );
  }

  if (!scan) return null;

  const verdictColor =
    scan.verdict === "safe" ? "text-primary" :
    scan.verdict === "needs_review" ? "text-amber-500" :
    "text-destructive";
  const VerdictIcon =
    scan.verdict === "safe" ? CheckCircle2 :
    scan.verdict === "needs_review" ? AlertTriangle :
    ShieldAlert;

  const blocks = scan.findings.filter((f) => f.severity === "block");
  const warns = scan.findings.filter((f) => f.severity === "warn");
  const infos = scan.findings.filter((f) => f.severity === "info");

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <VerdictIcon className={cn("w-5 h-5 mt-0.5", verdictColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium truncate">{m?.name ?? "Skill"}</h3>
            {m?.slug && <Badge variant="outline" className="text-xs font-mono">{m.slug}</Badge>}
            {result.format && <Badge variant="secondary" className="text-xs">{result.format}</Badge>}
          </div>
          {m?.description && (
            <p className="text-sm text-muted-foreground mt-1">{m.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className={cn("font-medium", verdictColor)}>
              {scan.verdict === "safe" ? "Safe" : scan.verdict === "needs_review" ? "Needs review" : "Blocked"}
            </span>
            <span>·</span>
            <span>Score {scan.score}</span>
            {m?.tools_required && (
              <>
                <span>·</span>
                <span>{m.tools_required.length} tool{m.tools_required.length === 1 ? "" : "s"}</span>
              </>
            )}
            {scan.autofixes_applied.length > 0 && (
              <>
                <span>·</span>
                <span>{scan.autofixes_applied.length} autofix{scan.autofixes_applied.length === 1 ? "" : "es"}</span>
              </>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onDismiss}><X className="w-4 h-4" /></Button>
      </div>

      {result.installed && (
        <div className="text-sm text-primary flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Installed and enabled.
        </div>
      )}

      {(blocks.length > 0 || warns.length > 0 || infos.length > 0) && (
        <div className="space-y-2">
          {[...blocks, ...warns, ...infos].slice(0, 8).map((f, idx) => (
            <FindingRow key={idx} finding={f} />
          ))}
        </div>
      )}

      {scan.autofixes_applied.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Autofixes applied ({scan.autofixes_applied.length})
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {scan.autofixes_applied.map((fix, i) => (
              <li key={i} className="text-muted-foreground list-disc">{fix}</li>
            ))}
          </ul>
        </details>
      )}

      {!result.installed && scan.verdict === "needs_review" && (
        <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
          <Button size="sm" variant="ghost" onClick={onDismiss}>Cancel</Button>
          <Button size="sm" onClick={onForceInstall}>Install anyway</Button>
        </div>
      )}
    </Card>
  );
}

function FindingRow({ finding }: { finding: ScanFinding }) {
  const Icon =
    finding.severity === "block" ? ShieldAlert :
    finding.severity === "warn" ? AlertTriangle :
    FileText;
  const tone =
    finding.severity === "block" ? "border-destructive/40 text-destructive" :
    finding.severity === "warn" ? "border-amber-500/40 text-amber-600 dark:text-amber-400" :
    "border-border text-muted-foreground";

  return (
    <div className={cn("text-sm border-l-2 pl-3 py-1", tone)}>
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium text-foreground">{finding.title}</span>
        {finding.autofixed && <Badge variant="secondary" className="text-[10px] h-4 px-1">autofixed</Badge>}
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs whitespace-pre-line">{finding.detail}</p>
    </div>
  );
}
