interface PillButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  selected?: boolean;
}

export const PillButton = ({ children, onClick, selected = false }: PillButtonProps) => {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3 rounded-full text-base font-medium transition-all duration-200 ${
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
};
