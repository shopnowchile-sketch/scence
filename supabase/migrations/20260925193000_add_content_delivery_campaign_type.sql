-- Add a first-class campaign type for campaigns where the influencer records content and delivers the video to the client via Drive.
ALTER TYPE campaign_type ADD VALUE IF NOT EXISTS 'content_delivery';
