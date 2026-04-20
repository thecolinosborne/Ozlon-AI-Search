import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Upload, Type, Link as LinkIcon } from "lucide-react";
import { wisdomService, parseFileToText } from "@/services/wisdomService";
import { toast } from "@/hooks/use-toast";

interface Props {
  onIngested?: () => void;
}

export const AddSourcePanel = ({ onIngested }: Props) => {
  const [busy, setBusy] = useState(false);

  // Common metadata
  const [person, setPerson] = useState("");
  const [material, setMaterial] = useState("");
  const [sourceType, setSourceType] = useState("book");
  const [extractMemories, setExtractMemories] = useState(true);
  const [generateReflection, setGenerateReflection] = useState(true);

  // Text mode
  const [text, setText] = useState("");

  // URL mode
  const [url, setUrl] = useState("");

  const validate = () => {
    if (!person.trim()) {
      toast({ title: "Author required", description: "Who is this knowledge from?", variant: "destructive" });
      return false;
    }
    return true;
  };

  const handleText = async () => {
    if (!validate()) return;
    if (text.trim().length < 200) {
      toast({ title: "Too short", description: "Paste at least a few paragraphs.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const results = await wisdomService.ingestChunked({
        text,
        source_person: person,
        source_material: material || undefined,
        source_type: sourceType,
        extract_memories: extractMemories,
        generate_reflection: generateReflection,
      });
      const total = results.reduce((s, r) => s + (r.entries_count || 0), 0);
      const ok = results.every((r) => r.success);
      toast({
        title: ok ? "Ingested" : "Partial ingest",
        description: `${total} entries from ${person}`,
        variant: ok ? "default" : "destructive",
      });
      if (ok) {
        setText("");
        setMaterial("");
        onIngested?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!validate()) return;
    setBusy(true);
    try {
      toast({ title: "Parsing document", description: file.name });
      const parsed = await parseFileToText(file);
      if (!parsed || parsed.length < 200) {
        toast({ title: "Empty document", description: "No text could be extracted.", variant: "destructive" });
        return;
      }
      const results = await wisdomService.ingestChunked({
        text: parsed,
        source_person: person,
        source_material: material || file.name,
        source_type: sourceType,
        extract_memories: extractMemories,
        generate_reflection: generateReflection,
      });
      const total = results.reduce((s, r) => s + (r.entries_count || 0), 0);
      const ok = results.every((r) => r.success);
      toast({
        title: ok ? "Ingested" : "Partial ingest",
        description: `${total} entries from ${file.name}`,
        variant: ok ? "default" : "destructive",
      });
      if (ok) {
        setMaterial("");
        onIngested?.();
      }
    } catch (e) {
      toast({ title: "Parse failed", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleUrl = async () => {
    if (!validate()) return;
    if (!url.trim()) {
      toast({ title: "URL required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await wisdomService.fetchUrl({
        url,
        source_person: person,
        source_material: material || undefined,
        source_type: sourceType || "article",
        extract_memories: extractMemories,
        generate_reflection: generateReflection,
      });
      if (res.success) {
        toast({ title: "Ingested", description: `${res.entries_count || 0} entries from URL` });
        setUrl("");
        setMaterial("");
        onIngested?.();
      } else {
        toast({ title: "Failed", description: res.error, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-card/40 backdrop-blur-md p-5 sm:p-6 space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Add a Source
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ws-person">Author / Source person</Label>
          <Input
            id="ws-person"
            placeholder="e.g. Charlie Munger"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-material">Title (optional)</Label>
          <Input
            id="ws-material"
            placeholder="e.g. Poor Charlie's Almanack — Ch. 2"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-type">Source type</Label>
          <select
            id="ws-type"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="book">Book</option>
            <option value="article">Article</option>
            <option value="podcast">Podcast / Transcript</option>
            <option value="lecture">Lecture / Talk</option>
            <option value="note">Personal note</option>
            <option value="frameworks">Frameworks</option>
          </select>
        </div>
        <div className="space-y-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="ws-mem" className="text-xs">Extract durable memories</Label>
            <Switch id="ws-mem" checked={extractMemories} onCheckedChange={setExtractMemories} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ws-ref" className="text-xs">Generate reflection note</Label>
            <Switch id="ws-ref" checked={generateReflection} onCheckedChange={setGenerateReflection} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="text">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="text"><Type className="w-3.5 h-3.5 mr-1.5" />Paste Text</TabsTrigger>
          <TabsTrigger value="upload"><Upload className="w-3.5 h-3.5 mr-1.5" />Upload</TabsTrigger>
          <TabsTrigger value="url"><LinkIcon className="w-3.5 h-3.5 mr-1.5" />From URL</TabsTrigger>
        </TabsList>

        <TabsContent value="text" className="space-y-3">
          <Textarea
            placeholder="Paste a chapter, transcript, article, or notes…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[200px]"
          />
          <Button onClick={handleText} disabled={busy} className="w-full sm:w-auto">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Ingest text
          </Button>
        </TabsContent>

        <TabsContent value="upload" className="space-y-3">
          <label className="block">
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Supported: PDF, DOCX, TXT, MD. Long files are auto-chunked.
          </p>
        </TabsContent>

        <TabsContent value="url" className="space-y-3">
          <Input
            type="url"
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button onClick={handleUrl} disabled={busy} className="w-full sm:w-auto">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Fetch & ingest
          </Button>
          <p className="text-xs text-muted-foreground">
            We scrape the article via Firecrawl and extract structured insights.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
};
