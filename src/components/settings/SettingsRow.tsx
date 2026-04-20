import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, LucideIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

export interface SettingsRowProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  type?: "navigate" | "toggle" | "action" | "inline-edit";
  value?: boolean;
  onChange?: (value: boolean) => void;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  actionLabel?: string;
  badge?: string;
  // inline-edit specific
  editValue?: string;
  onEditSave?: (value: string) => void | Promise<void>;
  editPlaceholder?: string;
  rightSlot?: React.ReactNode;
}

export const SettingsRow = ({
  icon: Icon,
  label,
  description,
  type = "navigate",
  value,
  onChange,
  onClick,
  disabled = false,
  destructive = false,
  actionLabel,
  badge,
  editValue,
  onEditSave,
  editPlaceholder,
  rightSlot,
}: SettingsRowProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(editValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(editValue ?? "");
  }, [editValue]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (disabled) return;
    if (type === "inline-edit") {
      setIsEditing(true);
      return;
    }
    if (type !== "toggle" && onClick) onClick();
  };

  const handleToggle = (checked: boolean) => {
    if (disabled) return;
    onChange?.(checked);
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await onEditSave?.(trimmed);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDraft(editValue ?? "");
    setIsEditing(false);
  };

  const isInteractive = type !== "toggle" && type !== "inline-edit";
  const Wrapper = isInteractive ? "button" : "div";

  return (
    <Wrapper
      onClick={isInteractive ? handleClick : type === "inline-edit" && !isEditing ? handleClick : undefined}
      disabled={isInteractive ? disabled : undefined}
      className={cn(
        "w-full flex items-center gap-4 p-3.5 rounded-2xl transition-all duration-200",
        "bg-card/60 hover:bg-card/90 border border-border/30",
        "hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]",
        disabled && "opacity-50 cursor-not-allowed hover:shadow-none",
        destructive && "hover:bg-destructive/10 hover:shadow-[0_0_0_1px_hsl(var(--destructive)/0.3)]",
        (isInteractive || (type === "inline-edit" && !isEditing)) && "cursor-pointer",
      )}
    >
      <div
        className={cn(
          "p-2.5 rounded-xl bg-gradient-to-br",
          destructive
            ? "from-destructive/15 to-destructive/5"
            : "from-muted/80 to-muted/40",
        )}
      >
        <Icon
          className={cn("w-5 h-5", destructive ? "text-destructive" : "text-foreground/80")}
          strokeWidth={1.5}
        />
      </div>

      <div className="flex-1 text-left min-w-0">
        {type === "inline-edit" && isEditing ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
              placeholder={editPlaceholder}
              className={cn(
                "flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSave();
              }}
              className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label="Save"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCancel();
              }}
              className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <p
                className={cn(
                  "font-medium text-sm",
                  destructive ? "text-destructive" : "text-foreground",
                )}
              >
                {label}
              </p>
              {badge && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                  {badge}
                </span>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
            )}
            {type === "inline-edit" && editValue && (
              <p className="text-xs text-foreground/80 mt-0.5 truncate font-mono">{editValue}</p>
            )}
          </>
        )}
      </div>

      {!isEditing && (
        <>
          {rightSlot}
          {type === "toggle" && (
            <Switch checked={value} onCheckedChange={handleToggle} disabled={disabled} />
          )}
          {type === "navigate" && (
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          )}
          {type === "inline-edit" && (
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          )}
          {type === "action" && actionLabel && (
            <span className={cn(
              "text-sm font-medium shrink-0",
              destructive ? "text-destructive" : "text-primary",
            )}>
              {actionLabel}
            </span>
          )}
        </>
      )}
    </Wrapper>
  );
};
