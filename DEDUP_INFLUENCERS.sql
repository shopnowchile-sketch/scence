-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — DEDUPLICAR INFLUENCERS
-- Paso 1: Corre el SELECT para ver duplicados antes de eliminar nada
-- Paso 2: Corre el DELETE cuando confirmes que los duplicados son correctos
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── PASO 1: Ver duplicados por display_name (lectura segura) ──────────────────
SELECT
  display_name,
  COUNT(*)           AS total,
  MIN(created_at)    AS primera_creacion,
  MAX(created_at)    AS ultima_creacion,
  ARRAY_AGG(id ORDER BY created_at ASC) AS ids
FROM influencers
GROUP BY display_name
HAVING COUNT(*) > 1
ORDER BY total DESC, display_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: Eliminar duplicados — conserva el registro MÁS ANTIGUO por nombre
-- (Comentado por seguridad — descomenta sólo cuando hayas visto el PASO 1)
-- ─────────────────────────────────────────────────────────────────────────────

/*
-- 2a. Primero reasignar campaign_influencers al original
WITH ranked AS (
  SELECT id,
         display_name,
         ROW_NUMBER() OVER (PARTITION BY display_name ORDER BY created_at ASC) AS rn
  FROM influencers
),
originals AS (
  SELECT id AS original_id, display_name FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT r.id AS dupe_id, o.original_id
  FROM ranked r
  JOIN originals o ON o.display_name = r.display_name
  WHERE r.rn > 1
)
UPDATE campaign_influencers ci
SET influencer_id = d.original_id
FROM dupes d
WHERE ci.influencer_id = d.dupe_id;

-- 2b. Reasignar affiliate_links al original
WITH ranked AS (
  SELECT id, display_name,
         ROW_NUMBER() OVER (PARTITION BY display_name ORDER BY created_at ASC) AS rn
  FROM influencers
),
originals AS (SELECT id AS original_id, display_name FROM ranked WHERE rn = 1),
dupes AS (
  SELECT r.id AS dupe_id, o.original_id
  FROM ranked r JOIN originals o ON o.display_name = r.display_name WHERE r.rn > 1
)
UPDATE affiliate_links al
SET influencer_id = d.original_id
FROM dupes d WHERE al.influencer_id = d.dupe_id;

-- 2c. Reasignar influencer_tasks al original
WITH ranked AS (
  SELECT id, display_name,
         ROW_NUMBER() OVER (PARTITION BY display_name ORDER BY created_at ASC) AS rn
  FROM influencers
),
originals AS (SELECT id AS original_id, display_name FROM ranked WHERE rn = 1),
dupes AS (
  SELECT r.id AS dupe_id, o.original_id
  FROM ranked r JOIN originals o ON o.display_name = r.display_name WHERE r.rn > 1
)
UPDATE influencer_tasks it
SET influencer_id = d.original_id
FROM dupes d WHERE it.influencer_id = d.dupe_id;

-- 2d. Eliminar los duplicados (los más recientes por nombre)
DELETE FROM influencers
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY display_name ORDER BY created_at ASC) AS rn
    FROM influencers
  ) ranked
  WHERE rn > 1
);

-- Verificar resultado
SELECT COUNT(*) AS total_influencers_restantes FROM influencers;
*/

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOTA: Si hay duplicados con el MISMO nombre pero distintos datos de Instagram,
-- usa este query para ver cuál tiene más datos antes de decidir cuál conservar:
-- ═══════════════════════════════════════════════════════════════════════════════
/*
SELECT i.id, i.display_name, i.email, i.created_at,
       isp.platform, isp.username, isp.followers, isp.engagement_rate
FROM influencers i
LEFT JOIN influencer_social_profiles isp ON isp.influencer_id = i.id
WHERE i.display_name IN (
  SELECT display_name FROM influencers
  GROUP BY display_name HAVING COUNT(*) > 1
)
ORDER BY i.display_name, i.created_at;
*/
