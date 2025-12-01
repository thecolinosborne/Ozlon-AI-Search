interface ActionButtonsProps {
  actions: string[];
  onAction: (action: string) => void;
}

export const ActionButtons = ({ actions, onAction }: ActionButtonsProps) => {
  return (
    <div className="flex gap-2 mt-3 flex-wrap">
      {actions.map((action, index) => (
        <button
          key={index}
          onClick={() => onAction(action)}
          className="px-4 py-2 rounded-full bg-background/40 backdrop-blur-sm border border-border/30 text-sm text-foreground/80 hover:bg-background/60 hover:border-border/50 transition-all duration-200 hover:scale-105"
        >
          {action}
        </button>
      ))}
    </div>
  );
};
