-- Campaign creation must support an optional WhatsApp group URL.
-- This is nullable by design: campaigns must remain creatable even when no group exists yet.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS whatsapp_group_url text;
