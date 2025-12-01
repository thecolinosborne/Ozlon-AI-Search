interface ActionButtonsProps {
  actions: string[];
  onAction: (action: string) => void;
}

export const ActionButtons = ({ actions, onAction }: ActionButtonsProps) => {
  return (
    <div className="flex gap-3 mt-4 flex-wrap">
      {actions.map((action, index) => (
        <button
          key={index}
          onClick={() => onAction(action)}
          className="px-5 py-2.5 rounded-full bg-background/60 backdrop-blur-md border border-border/40 text-sm text-foreground/80 hover:bg-background/80 hover:border-border/60 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-sm"
          style={{ boxShadow: "0 2px 8px -2px hsl(var(--primary) / 0.1)" }}
        >
          {action}
        </button>
      ))}
    </div>
  );
};
