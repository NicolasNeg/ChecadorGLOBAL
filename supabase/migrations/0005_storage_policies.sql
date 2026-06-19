-- ── Storage: create public buckets and allow anon uploads ──────────────────

-- Create buckets if they don't exist; make them public (URL-accessible)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('fotos',  'fotos',  true),
  ('firmas', 'firmas', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Drop old policies if they exist (idempotent re-run)
DROP POLICY IF EXISTS "anon_insert_fotos"  ON storage.objects;
DROP POLICY IF EXISTS "anon_insert_firmas" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_fotos"    ON storage.objects;
DROP POLICY IF EXISTS "anon_read_firmas"   ON storage.objects;

-- Allow anon to upload photos
CREATE POLICY "anon_insert_fotos" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'fotos');

-- Allow anon to upload signatures
CREATE POLICY "anon_insert_firmas" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'firmas');

-- Allow anon to read photos (belt-and-suspenders: public bucket handles this too)
CREATE POLICY "anon_read_fotos" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'fotos');

-- Allow anon to read signatures
CREATE POLICY "anon_read_firmas" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'firmas');
