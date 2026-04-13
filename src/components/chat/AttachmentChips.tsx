import React from "react";
import { X } from "lucide-react";

interface AttachmentChipsProps {
  files: File[];
  onRemove: (index: number) => void;
  getFileIcon: (file: File) => React.ReactNode;
  size?: "normal" | "small";
}

export const AttachmentChips = ({ files, onRemove, getFileIcon, size = "normal" }: AttachmentChipsProps) => {
  if (files.length === 0) return null;

  const isSmall = size === "small";

  return (
    <div className={`flex flex-wrap gap-2 ${isSmall ? "mb-2" : "mb-3 px-2"}`}>
      {files.map((file, index) => (
        <div
          key={index}
          className={`flex items-center gap-2 bg-neutral-100 rounded-full ${
            isSmall ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
          }`}
        >
          {getFileIcon(file)}
          <span className={`truncate ${isSmall ? "max-w-[100px]" : "max-w-[150px]"}`}>
            {file.name}
          </span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-neutral-400 hover:text-neutral-600"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
};
