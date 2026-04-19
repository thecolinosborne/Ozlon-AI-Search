// Type-aware renderer for typed artifacts (deliverables).
// Each type renders natively + offers 1-3 native actions.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, ExternalLink, Mail, FileText, Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { Artifact } from '@/hooks/useThread';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Props {
  artifact: Artifact;
  isLatest: boolean;
  onRevise?: () => void;
}

export function ArtifactRenderer({ artifact, isLatest, onRevise }: Props) {
  const [acting, setActing] = useState<string | null>(null);

  const copy = async () => {
    const text = String(artifact.content?.text ?? artifact.content?.body ?? JSON.stringify(artifact.content));
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  };

  const callTool = async (tool: string, args: Record<string, unknown>) => {
    setActing(tool);
    try {
      const { data, error } = await supabase.functions.invoke(tool, { body: args });
      if (error || !data?.success) throw new Error(error?.message || data?.error || 'Failed');
      toast.success(`Sent to ${tool.replace(/^google-/, '')}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActing(null);
    }
  };

  const typeLabel: Record<string, string> = {
    markdown: 'Document',
    email_draft: 'Email draft',
    doc_link: 'Linked doc',
    image: 'Image',
    file: 'File',
    checklist: 'Checklist',
    decision: 'Decision',
    action_result: 'Action result',
    plan: 'Plan',
  };

  return (
    <div className={cn(
      "rounded-2xl border bg-card/40 backdrop-blur-md overflow-hidden",
      isLatest ? "border-primary/40" : "border-border/30 opacity-70"
    )}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/20">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">{typeLabel[artifact.type] ?? artifact.type}</Badge>
          <span>v{artifact.version}</span>
          {!isLatest && <span className="opacity-60">— superseded</span>}
        </div>
        {artifact.title && <span className="text-xs text-muted-foreground truncate max-w-[40%]">{artifact.title}</span>}
      </div>

      <div className="p-4">
        {renderBody(artifact)}
      </div>

      {isLatest && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-border/30 bg-muted/10">
          <Button size="sm" variant="ghost" onClick={copy}>
            <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
          </Button>
          {onRevise && (
            <Button size="sm" variant="ghost" onClick={onRevise}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Revise
            </Button>
          )}
          {artifact.type === 'email_draft' && (
            <Button size="sm" variant="outline" disabled={acting !== null}
              onClick={() => callTool('google-gmail', {
                action: 'send',
                to: artifact.content?.to,
                subject: artifact.content?.subject,
                body: artifact.content?.body ?? artifact.content?.text,
              })}>
              <Mail className="w-3.5 h-3.5 mr-1.5" /> Send via Gmail
            </Button>
          )}
          {artifact.type === 'markdown' && (
            <Button size="sm" variant="outline" disabled={acting !== null}
              onClick={() => callTool('google-docs', {
                action: 'create',
                title: artifact.title ?? 'Untitled',
                body: artifact.content?.text,
              })}>
              <FileText className="w-3.5 h-3.5 mr-1.5" /> Save to Google Doc
            </Button>
          )}
          {artifact.type === 'doc_link' && artifact.external_ref?.url && (
            <Button size="sm" variant="outline" asChild>
              <a href={String(artifact.external_ref.url)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open
              </a>
            </Button>
          )}
          {artifact.type === 'checklist' && (
            <Button size="sm" variant="outline" disabled={acting !== null}
              onClick={() => callTool('clickup', {
                action: 'create_tasks_bulk',
                items: artifact.content?.items,
              })}>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Push to ClickUp
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function renderBody(artifact: Artifact) {
  const c = artifact.content as Record<string, unknown>;
  switch (artifact.type) {
    case 'markdown':
    case 'plan':
    case 'decision':
    case 'action_result':
      return (
        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(c.text ?? '')}</ReactMarkdown>
        </div>
      );
    case 'email_draft':
      return (
        <div className="space-y-2 text-sm">
          {c.to && <div><span className="text-muted-foreground">To: </span>{String(c.to)}</div>}
          {c.subject && <div className="font-medium">{String(c.subject)}</div>}
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none pt-2 border-t border-border/30">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(c.body ?? c.text ?? '')}</ReactMarkdown>
          </div>
        </div>
      );
    case 'doc_link':
      return (
        <div className="text-sm">
          <div className="font-medium">{String(c.title ?? 'Document')}</div>
          {c.summary && <div className="text-muted-foreground mt-1">{String(c.summary)}</div>}
        </div>
      );
    case 'image':
      return c.url ? <img src={String(c.url)} alt={artifact.title ?? ''} className="rounded-lg max-h-80" /> : null;
    case 'file':
      return (
        <div className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" />
          <span>{String(c.name ?? 'file')}</span>
        </div>
      );
    case 'checklist': {
      const items = Array.isArray(c.items) ? c.items as Array<{ title?: string; done?: boolean }> : [];
      return (
        <ul className="space-y-1.5 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <div className={cn("mt-1 w-3.5 h-3.5 rounded-full border", it.done ? "bg-primary border-primary" : "border-border")} />
              <span className={it.done ? "line-through text-muted-foreground" : ""}>{it.title}</span>
            </li>
          ))}
        </ul>
      );
    }
    default:
      return <pre className="text-xs text-muted-foreground overflow-x-auto">{JSON.stringify(c, null, 2)}</pre>;
  }
}
