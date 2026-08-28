import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface IngestedDocument {
  document_id: string;
  name: string;
  summary?: string;
  chars?: number;
}

export function useFileAttachments() {
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
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

  const clearFiles = useCallback(() => setAttachedFiles([]), []);

  /**
   * Uploads every attached file to the private `documents` bucket, then asks the
   * backend to extract and index its text. Returns the ingested documents so the
   * chat request can reference them.
   */
  const uploadAndIngest = useCallback(async (): Promise<IngestedDocument[]> => {
    if (attachedFiles.length === 0) return [];

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sign in to upload documents");
      return [];
    }

    setIsUploading(true);
    const toastId = toast.loading(
      attachedFiles.length === 1 ? `Reading ${attachedFiles[0].name}…` : `Reading ${attachedFiles.length} files…`
    );
    const results: IngestedDocument[] = [];

    try {
      for (const file of attachedFiles) {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (upErr) {
          toast.error(`Upload failed for ${file.name}: ${upErr.message}`);
          continue;
        }

        const { data, error } = await supabase.functions.invoke("document-ingest", {
          body: { action: "ingest", storage_path: path, name: file.name, mime_type: file.type },
        });

        if (error || !data?.document_id) {
          const msg = (data as { error?: string } | null)?.error || error?.message || "could not be read";
          toast.error(`${file.name}: ${msg}`);
          continue;
        }
        results.push(data as IngestedDocument);
      }

      if (results.length) {
        toast.success(
          results.length === 1 ? `${results[0].name} is ready` : `${results.length} documents are ready`,
          { id: toastId }
        );
        setAttachedFiles([]);
      } else {
        toast.dismiss(toastId);
      }
    } finally {
      setIsUploading(false);
    }

    return results;
  }, [attachedFiles]);

  return {
    attachedFiles,
    fileInputRef,
    handleFileSelect,
    removeFile,
    triggerFileUpload,
    uploadAndIngest,
    clearFiles,
    isUploading,
  };
}
