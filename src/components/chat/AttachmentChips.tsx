import React, { useMemo } from "react";
import { X, FileText, Image as ImageIcon } from "lucide-react";

interface AttachmentChipsProps {
  files: File[];
  onRemove: (index: number) => void;
  size?: "normal" | "small";
}

const FileChip = ({ file, index, onRemove, isSmall }: { file: File; index: number; onRemove: (i: number) => void; isSmall: boolean }) => {
  const thumbnail = useMemo(() => {
    if (file.type.startsWith("image/")) {
      return URL.createObjectURL(file);
    }
    return null;
  }, [file]);

  React.useEffect(() => {
    return () => { if (thumbnail) URL.revokeObjectURL(thumbnail); };
  }, [thumbnail]);

  return (
    <div
      className={`group flex items-center gap-2 bg-neutral-100 hover:bg-neutral-150 rounded-lg transition-all ${
        isSmall ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm"
      }`}
    >
      {thumbnail ? (
        <img src={thumbnail} alt="" className={`rounded object-cover ${isSmall ? "w-4 h-4" : "w-5 h-5"}`} />
      ) : file.type.startsWith("image/") ? (
        <ImageIcon className={isSmall ? "w-3.5 h-3.5 text-neutral-500" : "w-4 h-4 text-neutral-500"} />
      ) : (
        <FileText className={isSmall ? "w-3.5 h-3.5 text-neutral-500" : "w-4 h-4 text-neutral-500"} />
      )}
      <span className={`truncate text-neutral-700 ${isSmall ? "max-w-[100px]" : "max-w-[140px]"}`}>
        {file.name}
      </span>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="text-neutral-400 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

export const AttachmentChips = ({ files, onRemove, size = "normal" }: AttachmentChipsProps) => {
  if (files.length === 0) return null;
  const isSmall = size === "small";

  return (
    <div className={`flex flex-wrap gap-1.5 ${isSmall ? "mb-2" : "mb-3 px-2"}`}>
      {files.map((file, index) => (
        <FileChip key={index} file={file} index={index} onRemove={onRemove} isSmall={isSmall} />
      ))}
    </div>
  );
};
