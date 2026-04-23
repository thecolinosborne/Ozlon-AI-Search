import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, X } from "lucide-react";

interface SlackStatusBannerProps {
  reason: string | null;
  scope?: string | null;
}

const SCOPE_HINT_MAP: Record<string, string> = {
  missing_scope: "im:history",
};

export function SlackStatusBanner({ reason, scope }: SlackStatusBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !reason) return null;

  const scopeName = scope || SCOPE_HINT_MAP[reason] || null;
  const message =
    reason === "missing_scope" && scopeName
      ? `Slack messages can't load — missing \`${scopeName}\` scope.`
      : reason === "timeout"
        ? "Slack took too long to respond."
        : "Slack messages couldn't load.";

  return (
    <div className="mx-4 lg:mx-6 mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-card/40 border border-border/30 backdrop-blur-xl">
      <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <p className="text-[12px] text-muted-foreground flex-1 leading-snug">
        {message}{" "}
        <Link
          to="/integrations/slack"
          className="text-primary font-medium hover:underline"
        >
          Fix scopes →
        </Link>
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 -m-1 text-muted-foreground/60 hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
