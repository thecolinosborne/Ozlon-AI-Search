import { ArrowRight, Clock } from "lucide-react";
import { ConversationSession } from "@/hooks/useConversations";
import { differenceInHours, differenceInMinutes, format, isYesterday, subDays, isAfter } from "date-fns";

interface ContinueCardProps {
  session: ConversationSession;
  onContinue: (id: string) => void;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const mins = differenceInMinutes(now, d);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = differenceInHours(now, d);
  if (hrs < 24) return `${hrs}h ago`;
  if (isYesterday(d)) return "yesterday";
  if (isAfter(d, subDays(now, 7))) return format(d, "EEEE");
  return format(d, "MMM d");
}

export const ContinueCard = ({ session, onContinue }: ContinueCardProps) => {
  const title =
    session.title && session.title !== "New conversation"
      ? session.title
      : session.preview?.slice(0, 50) || "Previous conversation";
  const snippet = session.summary?.trim() || session.preview?.trim() || "";

  return (
    <button
      type="button"
      onClick={() => onContinue(session.id)}
      className="group w-full max-w-md mt-6 text-left rounded-2xl border border-neutral-200 bg-white/60 backdrop-blur-sm hover:bg-white hover:border-neutral-300 transition-all p-4 shadow-sm hover:shadow-md"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400 mb-2">
        <Clock className="w-3 h-3" />
        Continue where you left off · {formatRelative(session.updated_at)}
      </div>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-800 truncate">{title}</p>
          {snippet && (
            <p className="text-xs text-neutral-500 mt-1 line-clamp-2 leading-snug">{snippet}</p>
          )}
        </div>
        <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-neutral-700 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-0.5" />
      </div>
    </button>
  );
};
