-- ============================================================================
-- ROLLBACK — Marcas colaboradoras comerciales por campaña
-- Revierte exclusivamente 20261009120000_campaign_brand_collaborations.sql, en
-- orden inverso de dependencias:
--   1) crm_lead_activities.campaign_id (+ su índice)
--   2) campaign_brand_collaborations  (referencia a campaign_collaboration_plans)
--   3) campaign_collaboration_plans
--
-- PRECONDICIÓN: revertir antes el código (pestaña "Marcas colaboradoras" y las rutas
-- /api/campaigns/[id]/collaborations/**) a la versión anterior; si no, la pestaña
-- mostrará error al no encontrar las tablas.
--
-- DATOS QUE SE PIERDEN una vez que la funcionalidad esté en uso:
--   - TODAS las colaboraciones (estado, tipo, aporte, cantidad, próximo paso, fecha de
--     seguimiento, responsable y plan elegido por marca).
--   - TODOS los planes definidos por campaña (nombre, monto, descripción).
--   - La marca "Esta campaña" de las notas del CRM: `campaign_id` desaparece de
--     crm_lead_activities. Las notas e historial en sí NO se borran: quedan como
--     entradas generales del lead.
-- NO se tocan: crm_leads, brands, campaign_brands, contracts, campaigns, notas.
--
-- RECOMENDACIÓN: antes de ejecutar, respaldar lo que se vaya a perder:
--   CREATE SCHEMA IF NOT EXISTS ops;
--   CREATE TABLE ops.campaign_brand_collaborations_bk AS TABLE public.campaign_brand_collaborations;
--   CREATE TABLE ops.campaign_collaboration_plans_bk  AS TABLE public.campaign_collaboration_plans;
--   CREATE TABLE ops.crm_lead_activities_campaign_bk  AS
--     SELECT id, campaign_id FROM public.crm_lead_activities WHERE campaign_id IS NOT NULL;
-- ============================================================================
BEGIN;

DROP INDEX IF EXISTS public.crm_lead_activities_campaign_idx;
ALTER TABLE public.crm_lead_activities DROP COLUMN IF EXISTS campaign_id;

DROP TABLE IF EXISTS public.campaign_brand_collaborations;
DROP TABLE IF EXISTS public.campaign_collaboration_plans;

COMMIT;
