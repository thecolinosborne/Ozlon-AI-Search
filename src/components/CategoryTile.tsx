import { LucideIcon } from "lucide-react";

interface CategoryTileProps {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
}

export const CategoryTile = ({ icon: Icon, title, onClick }: CategoryTileProps) => {
  return (
    <button
      onClick={onClick}
      className="w-full p-6 bg-secondary rounded-2xl flex flex-col items-center gap-3 transition-all duration-300 hover:scale-105 hover:bg-accent active:scale-95"
    >
      <Icon className="w-8 h-8 text-primary" />
      <span className="text-lg font-medium text-foreground">{title}</span>
    </button>
  );
};
