
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('generated-videos', 'generated-videos', true, 104857600)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Generated videos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated-videos');

CREATE POLICY "Users can upload their own generated videos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'generated-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can manage generated videos"
ON storage.objects FOR ALL
USING (bucket_id = 'generated-videos' AND auth.role() = 'service_role');
