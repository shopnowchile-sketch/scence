-- Un evento de campaña puede definirse antes de asignar influencers.
-- Los bookings individuales siguen pudiendo tener influencer_id, pero ya no es obligatorio.
ALTER TABLE public.bookings
  ALTER COLUMN influencer_id DROP NOT NULL;
