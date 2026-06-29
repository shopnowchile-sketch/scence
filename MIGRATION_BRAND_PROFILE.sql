-- ═══════════════════════════════════════════════════════════════════════════
-- SCENCE — MIGRATION: Brand Profile Completo + Multi-Usuario
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Nuevos campos en tabla brands ────────────────────────────────────────

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS rut              TEXT,           -- RUT empresa ej: 76.123.456-7
  ADD COLUMN IF NOT EXISTS instagram        TEXT,           -- @handle sin @
  ADD COLUMN IF NOT EXISTS address_street   TEXT,
  ADD COLUMN IF NOT EXISTS address_number   TEXT,
  ADD COLUMN IF NOT EXISTS address_city     TEXT,
  ADD COLUMN IF NOT EXISTS address_region   TEXT,
  ADD COLUMN IF NOT EXISTS address_country  TEXT DEFAULT 'Chile',
  ADD COLUMN IF NOT EXISTS address2_street  TEXT,           -- dirección secundaria
  ADD COLUMN IF NOT EXISTS address2_number  TEXT,
  ADD COLUMN IF NOT EXISTS address2_city    TEXT,
  ADD COLUMN IF NOT EXISTS address2_region  TEXT,
  ADD COLUMN IF NOT EXISTS address2_country TEXT,
  ADD COLUMN IF NOT EXISTS user_id          UUID REFERENCES auth.users(id); -- owner

-- ── 2. Tabla brand_members (multi-usuario por marca) ────────────────────────

CREATE TABLE IF NOT EXISTS brand_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'editor'   CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by  UUID REFERENCES auth.users(id),
  invited_at  TIMESTAMPTZ DEFAULT now(),
  joined_at   TIMESTAMPTZ,
  is_active   BOOLEAN DEFAULT TRUE,
  UNIQUE(brand_id, email)
);

CREATE INDEX IF NOT EXISTS idx_brand_members_brand ON brand_members(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_members_user  ON brand_members(user_id);

-- ── 3. RLS brand_members ─────────────────────────────────────────────────────

ALTER TABLE brand_members ENABLE ROW LEVEL SECURITY;

-- Admin org puede ver todos los miembros de sus marcas
CREATE POLICY "org_members_read_brand_members" ON brand_members
  FOR SELECT USING (
    brand_id IN (
      SELECT id FROM brands
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND is_active = TRUE
      )
    )
  );

-- Brand owner puede invitar miembros a su marca
CREATE POLICY "brand_owner_insert_members" ON brand_members
  FOR INSERT WITH CHECK (
    brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid())
  );

-- Brand owner puede desactivar miembros
CREATE POLICY "brand_owner_update_members" ON brand_members
  FOR UPDATE USING (
    brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid())
  );

-- ── 4. Migrar user_id existente en brands si hay un created_by ──────────────
-- Solo si user_id está NULL y created_by existe
UPDATE brands SET user_id = created_by WHERE user_id IS NULL AND created_by IS NOT NULL;

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────
SELECT
  column_name, data_type
FROM information_schema.columns
WHERE table_name = 'brands'
  AND column_name IN ('rut','instagram','address_street','address_city','user_id')
ORDER BY column_name;
