import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Command, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchCommands, setCommandNavigationHandler } from "@/core/commands";
import type { Command as CommandType } from "@/core/types";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette = ({ isOpen, onClose }: CommandPaletteProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandType[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Set up navigation handler
  useEffect(() => {
    setCommandNavigationHandler((path) => {
      navigate(path);
      onClose();
    });
  }, [navigate, onClose]);

  // Search commands
  useEffect(() => {
    if (query) {
      setResults(searchCommands(query).slice(0, 8));
    } else {
      setResults(searchCommands("").slice(0, 8));
    }
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      results[selectedIndex].handler();
      onClose();
    }
  }, [isOpen, onClose, results, selectedIndex]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Global shortcut to open
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-lg mx-4 bg-card border border-border rounded-2xl shadow-lg overflow-hidden animate-scale-in">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              No commands found
            </div>
          ) : (
            results.map((cmd, index) => (
              <button
                key={cmd.id}
                onClick={() => {
                  cmd.handler();
                  onClose();
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors",
                  index === selectedIndex ? "bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                <Command className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{cmd.label}</div>
                  {cmd.description && (
                    <div className="text-xs text-muted-foreground truncate">{cmd.description}</div>
                  )}
                </div>
                {cmd.shortcut && (
                  <kbd className="px-2 py-1 text-xs bg-muted rounded">{cmd.shortcut}</kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
          <span>Navigate with arrow keys</span>
          <span>Press Enter to select</span>
        </div>
      </div>
    </div>
  );
};
