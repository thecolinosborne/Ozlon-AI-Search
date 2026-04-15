import { useRef, useState } from "react";
import { Eye, EyeOff, Check, Key, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApiKeyInputProps {
  label: string;
  placeholder?: string;
  configured: boolean;
  onSave: (key: string) => void | Promise<void>;
  saving?: boolean;
  maskedHint?: string;
}

export const ApiKeyInput = ({ label, placeholder = "Enter API key…", configured, onSave, saving, maskedHint }: ApiKeyInputProps) => {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    const nextValue = (inputRef.current?.value ?? value).trim();
    if (!nextValue || saving) return;

    await onSave(nextValue);
    setValue("");
    setEditing(false);
  };

  const showInput = !configured || editing;

  return (
    <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
      <div className="flex items-center gap-2">
        <Key className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        {configured && !editing && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
            <Check className="w-3 h-3" /> Configured
          </span>
        )}
      </div>

      {configured && !editing && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-mono text-muted-foreground tracking-wider">
            {maskedHint || "••••••••••••"}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Update
          </button>
        </div>
      )}

      {showInput && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
               ref={inputRef}
              type={visible ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
               onInput={(e) => setValue((e.target as HTMLInputElement).value)}
              placeholder={configured ? "Enter new value…" : placeholder}
              className={cn(
                "w-full px-3 py-2 pr-9 rounded-xl border border-border bg-background text-sm",
                "focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
              )}
            />
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
             type="button"
            onClick={handleSave}
             disabled={!!saving}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
               saving && "opacity-50 cursor-not-allowed"
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {configured && editing && (
            <button
               type="button"
              onClick={() => { setEditing(false); setValue(""); }}
              className="px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
};
