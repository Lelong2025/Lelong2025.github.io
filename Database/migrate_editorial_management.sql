BEGIN;

ALTER TABLE public.article_submissions
    ADD COLUMN IF NOT EXISTS source_article_id text,
    ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.article_submissions
    ALTER COLUMN exported_format DROP NOT NULL;

UPDATE public.article_submissions
SET source_article_id = COALESCE(NULLIF(article_snapshot->>'id', ''), id::text),
    submitted_at = COALESCE(exported_at, now())
WHERE source_article_id IS NULL;

-- Keep only the newest legacy row for each client article before adding uniqueness.
DELETE FROM public.article_submissions older
USING public.article_submissions newer
WHERE older.owner_id = newer.owner_id
  AND older.source_article_id = newer.source_article_id
  AND (older.submitted_at, older.id) < (newer.submitted_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS article_submissions_owner_article_key
ON public.article_submissions (owner_id, source_article_id);

DROP POLICY IF EXISTS "Admins can update all submissions" ON public.article_submissions;
CREATE POLICY "Admins can update all submissions"
ON public.article_submissions FOR UPDATE
TO authenticated
USING (public.is_magazine_admin())
WITH CHECK (public.is_magazine_admin());

DROP POLICY IF EXISTS "Users can delete own submissions" ON public.article_submissions;
CREATE POLICY "Users can delete own submissions"
ON public.article_submissions FOR DELETE
TO authenticated
USING (auth.uid() = owner_id OR public.is_magazine_admin());

GRANT DELETE ON TABLE public.article_submissions TO authenticated;

COMMIT;
