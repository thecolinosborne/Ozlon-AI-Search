import { Sparkles, Bot, Cpu, Zap, Brain, Wind, type LucideIcon } from "lucide-react";

export type ProviderFamily =
  | "openai"
  | "google"
  | "anthropic"
  | "xai"
  | "deepseek"
  | "mistral"
  | "unknown";

const LABELS: Record<string, string> = {
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 Mini",
  "gpt-5-nano": "GPT-5 Nano",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.4": "GPT-5.4",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "gemini-3-flash-preview": "Gemini 3 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "gemini-3-pro-image-preview": "Gemini 3 Pro Image",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image",
  "claude-3-5-sonnet": "Claude 3.5 Sonnet",
  "claude-3-opus": "Claude 3 Opus",
  "grok-2": "Grok 2",
  "deepseek-chat": "DeepSeek Chat",
  "mistral-large": "Mistral Large",
};

export function getModelLabel(id: string | undefined | null): {
  name: string;
  provider: ProviderFamily;
} {
  if (!id) return { name: "Unknown", provider: "unknown" };
  const lower = id.toLowerCase();
  const stripped = lower.replace(/^(openai|google|anthropic|xai|deepseek|mistral)\//, "");
  const name = LABELS[stripped] ?? LABELS[lower] ?? id;

  let provider: ProviderFamily = "unknown";
  if (lower.includes("gpt") || lower.startsWith("openai/")) provider = "openai";
  else if (lower.includes("gemini") || lower.startsWith("google/")) provider = "google";
  else if (lower.includes("claude") || lower.startsWith("anthropic/")) provider = "anthropic";
  else if (lower.includes("grok") || lower.startsWith("xai/")) provider = "xai";
  else if (lower.includes("deepseek")) provider = "deepseek";
  else if (lower.includes("mistral")) provider = "mistral";

  return { name, provider };
}

export function getProviderIcon(provider: ProviderFamily): LucideIcon {
  switch (provider) {
    case "google":
      return Sparkles;
    case "openai":
      return Bot;
    case "anthropic":
      return Brain;
    case "xai":
      return Zap;
    case "deepseek":
      return Wind;
    case "mistral":
      return Wind;
    default:
      return Cpu;
  }
}

export function formatLatency(ms: number | undefined | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatCost(usd: number | undefined | null): string | null {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}
