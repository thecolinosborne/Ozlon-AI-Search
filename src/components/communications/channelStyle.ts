import type { CommChannel } from "@/hooks/useCommunicationsFeed";
import { Mail, MessageSquare, Phone, Voicemail } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Whisper-quiet channel tints (HSL strings). These are accent dots only.
export function channelTint(channel: CommChannel): string {
  switch (channel) {
    case "email":
      return "hsl(220 90% 60%)";
    case "slack":
      return "hsl(280 70% 65%)";
    case "sms":
      return "hsl(150 60% 50%)";
    case "voicemail":
      return "hsl(38 92% 55%)";
  }
}

export function channelIcon(channel: CommChannel): LucideIcon {
  switch (channel) {
    case "email":
      return Mail;
    case "slack":
      return MessageSquare;
    case "sms":
      return Phone;
    case "voicemail":
      return Voicemail;
  }
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dateBucket(d: Date): "Today" | "Yesterday" | "This Week" | "Earlier" {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86_400_000);
  if (d >= startOfToday) return "Today";
  if (d >= startOfYesterday) return "Yesterday";
  if (d >= startOfWeek) return "This Week";
  return "Earlier";
}
