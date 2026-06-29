-- Add synced_at column to influencer_social_profiles
ALTER TABLE influencer_social_profiles
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Optional index for querying stale profiles
CREATE INDEX IF NOT EXISTS idx_isp_synced_at
  ON influencer_social_profiles (platform, synced_at)
  WHERE platform = 'instagram';
