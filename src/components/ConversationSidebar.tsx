import { useMemo } from "react";
import { Plus, Trash2, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationSession } from "@/hooks/useConversations";
import { isToday, isYesterday, subDays, isAfter, format, differenceInMinutes, differenceInHours } from "date-fns";

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const mins = differenceInMinutes(now, d);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = differenceInHours(now, d);
  if (hrs < 24) return `${hrs}h`;
  if (isYesterday(d)) return "Yesterday";
  if (isAfter(d, subDays(now, 7))) return format(d, "EEE");
  return format(d, "MMM d");
}

interface ConversationSidebarProps {
  open: boolean;
  onClose: () => void;
  sessions: ConversationSession[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

interface GroupedSessions {
  label: string;
  sessions: ConversationSession[];
}

function groupSessions(sessions: ConversationSession[]): GroupedSessions[] {
  const groups: GroupedSessions[] = [];
  const today: ConversationSession[] = [];
  const yesterday: ConversationSession[] = [];
  const week: ConversationSession[] = [];
  const older: ConversationSession[] = [];

  const sevenDaysAgo = subDays(new Date(), 7);

  for (const s of sessions) {
    const d = new Date(s.updated_at);
    if (isToday(d)) today.push(s);
    else if (isYesterday(d)) yesterday.push(s);
    else if (isAfter(d, sevenDaysAgo)) week.push(s);
    else older.push(s);
  }

  if (today.length) groups.push({ label: "Today", sessions: today });
  if (yesterday.length) groups.push({ label: "Yesterday", sessions: yesterday });
  if (week.length) groups.push({ label: "Previous 7 days", sessions: week });
  if (older.length) groups.push({ label: "Older", sessions: older });

  return groups;
}

export function ConversationSidebar({
  open,
  onClose,
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: ConversationSidebarProps) {
  const grouped = useMemo(() => groupSessions(sessions), [sessions]);

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={cn(
          "fixed top-0 left-0 bottom-0 z-[80] w-72 bg-background border-r border-border",
          "flex flex-col transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* New Chat button */}
        <div className="p-3">
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {grouped.length === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-8">No conversations yet</p>
          )}

          {grouped.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                {group.label}
              </p>
              {group.sessions.map((s) => {
                const previewText = s.summary?.trim() || s.preview?.trim() || "";
                const title = s.title && s.title !== "New conversation" ? s.title : (s.preview?.slice(0, 40) || "New conversation");
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "group flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors",
                      s.id === activeSessionId
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                    onClick={() => {
                      onSelectSession(s.id);
                      onClose();
                    }}
                  >
                    <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate text-sm font-medium">{title}</span>
                        <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
                          {formatRelative(s.updated_at)}
                        </span>
                      </div>
                      {previewText && (
                        <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5 leading-snug">
                          {previewText}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all flex-shrink-0"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
