import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

export function useFileAttachments() {
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const validFiles = files.filter((file) => {
        const maxSize = 20 * 1024 * 1024;
        if (file.size > maxSize) {
          toast.error(`${file.name} is too large (max 20MB)`);
          return false;
        }
        return true;
      });

      setAttachedFiles((prev) => {
        if (prev.length + validFiles.length > 10) {
          toast.error("Maximum 10 files per message");
          return prev;
        }
        return [...prev, ...validFiles];
      });
      e.target.value = "";
    },
    []
  );

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const triggerFileUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return { attachedFiles, fileInputRef, handleFileSelect, removeFile, triggerFileUpload };
}
