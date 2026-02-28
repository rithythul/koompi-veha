-- Board DOOH extensions (003b)
-- These ALTER TABLE statements are NOT idempotent; the runner checks before executing.

ALTER TABLE boards ADD COLUMN zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE boards ADD COLUMN latitude REAL;
ALTER TABLE boards ADD COLUMN longitude REAL;
ALTER TABLE boards ADD COLUMN address TEXT;
ALTER TABLE boards ADD COLUMN board_type TEXT NOT NULL DEFAULT 'led_billboard';
ALTER TABLE boards ADD COLUMN screen_width INTEGER;
ALTER TABLE boards ADD COLUMN screen_height INTEGER;
ALTER TABLE boards ADD COLUMN orientation TEXT NOT NULL DEFAULT 'landscape';
ALTER TABLE boards ADD COLUMN sell_mode TEXT NOT NULL DEFAULT 'house_only';
ALTER TABLE boards ADD COLUMN operating_hours_start TEXT;
ALTER TABLE boards ADD COLUMN operating_hours_end TEXT;

CREATE INDEX IF NOT EXISTS idx_boards_zone_id ON boards(zone_id);
CREATE INDEX IF NOT EXISTS idx_boards_sell_mode ON boards(sell_mode);
