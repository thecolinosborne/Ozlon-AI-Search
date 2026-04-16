-- Create storage bucket for video uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('video-uploads', 'video-uploads', false, 524288000)
ON CONFLICT (id) DO NOTHING;

-- Users can upload videos to their own folder
CREATE POLICY "Users can upload their own videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'video-uploads' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can read their own uploaded videos
CREATE POLICY "Users can read their own videos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'video-uploads' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own uploaded videos
CREATE POLICY "Users can delete their own videos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'video-uploads' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);