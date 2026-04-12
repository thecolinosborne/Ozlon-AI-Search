import { useState } from "react";
import { Zap, Clock, Route, BarChart3, AlertTriangle } from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { cn } from "@/lib/utils";

export interface InfinityRouterDebugData {
  path: string;
  scores: Record<string, number>;
  classification: {
    intent: string;
    input_length: number;
    needs_memory: boolean;
    needs_deep_reasoning: boolean;
    needs_multimodal: boolean;
    needs_live_data: boolean;
    confidence: number;
  };
  enrichment: string | null;
  timing_ms: number;
  fallback: boolean;
}

// Global store for debug data — lightweight, no extra dependencies
let _latestDebug: InfinityRouterDebugData | null = null;
const _listeners = new Set<() => void>();

export function pushInfinityDebug(data: InfinityRouterDebugData) {
  _latestDebug = data;
  _listeners.forEach(fn => fn());
}

function useInfinityDebug() {
  const [data, setData] = useState<InfinityRouterDebugData | null>(_latestDebug);
  useState(() => {
    const handler = () => setData({ ..._latestDebug! });
    _listeners.add(handler);
    return () => { _listeners.delete(handler); };
  });
  return data;
}

const pathColors: Record<string, string> = {
  gemini_flash: "text-yellow-500",
  gemini_pro: "text-purple-500",
  retrieval: "text-blue-500",
  action: "text-green-500",
  default_chat: "text-muted-foreground",
};

export const InfinityRouterDebug = () => {
  const debug = useInfinityDebug();

  return (
    <SettingsSection title="Infinity Router">
      {!debug ? (
        <div className="p-4 bg-card rounded-xl border border-border text-sm text-muted-foreground">
          No router data yet. Send a message to see routing decisions.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Path & Timing */}
          <div className="flex items-center justify-between p-4 bg-card rounded-xl border border-border">
            <div className="flex items-center gap-2">
              <Route className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Path:</span>
              <span className={cn("text-sm font-bold", pathColors[debug.path] || "text-foreground")}>
                {debug.path}
              </span>
              {debug.fallback && (
                <span className="flex items-center gap-1 text-xs text-orange-500">
                  <AlertTriangle className="w-3 h-3" /> fallback
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {debug.timing_ms}ms
            </div>
          </div>

          {/* Scores */}
          <div className="p-4 bg-card rounded-xl border border-border space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Scores</span>
            </div>
            {Object.entries(debug.scores)
              .sort(([, a], [, b]) => b - a)
              .map(([path, score]) => {
                const maxScore = Math.max(...Object.values(debug.scores), 1);
                return (
                  <div key={path} className="flex items-center gap-3">
                    <span className={cn("text-xs font-mono w-28", pathColors[path] || "text-foreground")}>{path}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", path === debug.path ? "bg-primary" : "bg-muted-foreground/30")}
                        style={{ width: `${(score / maxScore) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono w-6 text-right">{score}</span>
                  </div>
                );
              })}
          </div>

          {/* Classification */}
          <div className="p-4 bg-card rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Classification</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>Intent: <span className="font-mono text-foreground">{debug.classification.intent}</span></div>
              <div>Length: <span className="font-mono text-foreground">{debug.classification.input_length}</span></div>
              <div>Confidence: <span className="font-mono text-foreground">{(debug.classification.confidence * 100).toFixed(0)}%</span></div>
              <div>Memory: <span className="font-mono text-foreground">{debug.classification.needs_memory ? "✓" : "✗"}</span></div>
              <div>Deep: <span className="font-mono text-foreground">{debug.classification.needs_deep_reasoning ? "✓" : "✗"}</span></div>
              <div>Multimodal: <span className="font-mono text-foreground">{debug.classification.needs_multimodal ? "✓" : "✗"}</span></div>
            </div>
          </div>

          {/* Enrichment */}
          {debug.enrichment && (
            <div className="p-4 bg-card rounded-xl border border-border">
              <span className="text-xs font-medium text-muted-foreground">Enrichment injected ✓</span>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
};
