ALTER TYPE public.deliverable_type ADD VALUE IF NOT EXISTS 'event_attendance';
ALTER TABLE public.campaign_deliverables
  ADD COLUMN IF NOT EXISTS attendance_response text CHECK (attendance_response IN ('confirmed', 'declined')),
  ADD COLUMN IF NOT EXISTS attendance_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_note text;
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_attendance ON public.campaign_deliverables (campaign_id, type, attendance_response);
