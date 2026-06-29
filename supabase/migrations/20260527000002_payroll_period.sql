-- Add period dates to payroll_runs (missing from initial schema)
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end   DATE;

-- Add address/geo columns to influencers (used by frontend maps)
ALTER TABLE public.influencers
  ADD COLUMN IF NOT EXISTS address      TEXT,
  ADD COLUMN IF NOT EXISTS address_lat  NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS address_lng  NUMERIC(10,7);
