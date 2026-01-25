-- ============================================
-- Chat Images Storage Setup
-- Run this AFTER creating the bucket in Supabase Dashboard
-- ============================================

-- STEP 1: Create the bucket in Supabase Dashboard
-- Go to Storage > New bucket
-- Name: chat-images
-- Check "Public bucket"
-- Click Create

-- STEP 2: Run these policies in SQL Editor

-- Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload chat images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-images');

-- Allow authenticated users to view chat images
CREATE POLICY "Authenticated users can view chat images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-images');

-- Allow public viewing of chat images (for sharing)
CREATE POLICY "Public can view chat images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'chat-images');
