ALTER TABLE zones ADD COLUMN rate_per_slot REAL;
ALTER TABLE zones ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE campaigns ADD COLUMN budget REAL;
ALTER TABLE bookings ADD COLUMN cost_per_slot REAL;
ALTER TABLE bookings ADD COLUMN estimated_cost REAL;
ALTER TABLE creatives ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending_review';
ALTER TABLE creatives ADD COLUMN reviewed_by TEXT;
ALTER TABLE creatives ADD COLUMN reviewed_at TEXT;
