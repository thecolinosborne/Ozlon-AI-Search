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

const SLACK_CONNECTION_ID = "std_01kps81f9qetrvgev483jgmt5y";

export function SlackStatusBanner({ reason, scope }: SlackStatusBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !reason) return null;

  const scopeName = scope || SCOPE_HINT_MAP[reason] || null;
  const message =
    reason === "missing_scope" && scopeName
      ? `Slack DMs can't load — missing \`${scopeName}\` scope.`
      : reason === "timeout"
        ? "Slack took too long to respond."
        : "Slack messages couldn't load.";

  const handleGrantScope = () => {
    // Dispatch event the Lovable connector tool listens for to open the
    // reconnect dialog with the missing scope pre-selected.
    window.dispatchEvent(
      new CustomEvent("lovable:open-connector", {
        detail: {
          connection_id: SLACK_CONNECTION_ID,
          required_scopes: scopeName ? [scopeName] : ["im:history"],
        },
      }),
    );
  };

  return (
    <div className="mx-4 lg:mx-6 mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-card/40 border border-border/30 backdrop-blur-xl">
      <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <p className="text-[12px] text-muted-foreground flex-1 leading-snug">
        {message}{" "}
        <button
          onClick={handleGrantScope}
          className="text-primary font-medium hover:underline"
        >
          Grant scope →
        </button>{" "}
        <Link
          to="/integrations/slack"
          className="text-muted-foreground/70 hover:text-foreground hover:underline"
        >
          details
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
