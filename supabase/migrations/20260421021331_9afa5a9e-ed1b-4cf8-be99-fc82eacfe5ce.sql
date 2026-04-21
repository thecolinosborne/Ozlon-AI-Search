
-- Remove any overly-permissive listing policies on these buckets
DROP POLICY IF EXISTS "Public can list generated images" ON storage.objects;
DROP POLICY IF EXISTS "Public can list generated videos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can list generated-images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can list generated-videos" ON storage.objects;

-- Owner-only listing/select via authenticated role.
-- Files are stored under `${userId}/...`, so the first folder segment is the owner.
DROP POLICY IF EXISTS "Owners can list their generated images" ON storage.objects;
CREATE POLICY "Owners can list their generated images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'generated-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can list their generated videos" ON storage.objects;
CREATE POLICY "Owners can list their generated videos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'generated-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Public read of individual objects (by exact path) remains via the buckets being public.
-- Uploads: only the owning user can write into their own folder.
DROP POLICY IF EXISTS "Owners can upload generated images" ON storage.objects;
CREATE POLICY "Owners can upload generated images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'generated-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can upload generated videos" ON storage.objects;
CREATE POLICY "Owners can upload generated videos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'generated-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can delete their generated images" ON storage.objects;
CREATE POLICY "Owners can delete their generated images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'generated-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can delete their generated videos" ON storage.objects;
CREATE POLICY "Owners can delete their generated videos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'generated-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
