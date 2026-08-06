-- Resultado final de asistencia. La confirmación de la influencer se conserva
-- en attendance_response; este campo lo completa la marca/admin al cerrar el
-- evento. Permite excluir correctamente una inasistencia de los KPI.
ALTER TABLE public.campaign_deliverables
  ADD COLUMN IF NOT EXISTS attendance_outcome text
    CHECK (attendance_outcome IN ('attended', 'excused_absence', 'no_show')),
  ADD COLUMN IF NOT EXISTS attendance_outcome_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_attendance_outcome
  ON public.campaign_deliverables (campaign_id, attendance_outcome)
  WHERE attendance_outcome IS NOT NULL;
