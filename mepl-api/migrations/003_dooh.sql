-- DOOH Platform Migration (003)
-- Adds: zones, users, sessions, advertisers, campaigns, creatives, bookings, play_logs
-- Extends: boards with DOOH fields

-- Zones (geographic hierarchy)
CREATE TABLE IF NOT EXISTS zones (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT,
    zone_type   TEXT NOT NULL DEFAULT 'custom',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES zones(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_zones_parent_id ON zones(parent_id);

-- Users (session auth)
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Advertisers
CREATE TABLE IF NOT EXISTS advertisers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    contact_name  TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    is_house      INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id              TEXT PRIMARY KEY,
    advertiser_id   TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (advertiser_id) REFERENCES advertisers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser_id ON campaigns(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- Creatives (links campaigns to media)
CREATE TABLE IF NOT EXISTS creatives (
    id              TEXT PRIMARY KEY,
    campaign_id     TEXT NOT NULL,
    media_id        TEXT NOT NULL,
    name            TEXT,
    duration_secs   INTEGER,
    status          TEXT NOT NULL DEFAULT 'approved',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_creatives_campaign_id ON creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_creatives_media_id ON creatives(media_id);

-- Bookings (campaign placed on boards/zones)
CREATE TABLE IF NOT EXISTS bookings (
    id                TEXT PRIMARY KEY,
    campaign_id       TEXT NOT NULL,
    booking_type      TEXT NOT NULL,
    target_type       TEXT NOT NULL,
    target_id         TEXT NOT NULL,
    start_date        TEXT NOT NULL,
    end_date          TEXT NOT NULL,
    start_time        TEXT,
    end_time          TEXT,
    days_of_week      TEXT DEFAULT '0,1,2,3,4,5,6',
    slot_duration_secs INTEGER DEFAULT 15,
    slots_per_loop    INTEGER DEFAULT 1,
    priority          INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'confirmed',
    notes             TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id ON bookings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bookings_target ON bookings(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Play Logs (proof of play)
CREATE TABLE IF NOT EXISTS play_logs (
    id            TEXT PRIMARY KEY,
    board_id      TEXT NOT NULL,
    booking_id    TEXT,
    creative_id   TEXT,
    media_id      TEXT,
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    duration_secs INTEGER,
    status        TEXT NOT NULL DEFAULT 'played',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE SET NULL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_play_logs_board_id ON play_logs(board_id);
CREATE INDEX IF NOT EXISTS idx_play_logs_booking_id ON play_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_play_logs_started_at ON play_logs(started_at);

-- Seed house advertiser
INSERT OR IGNORE INTO advertisers (id, name, is_house) VALUES ('house', 'House (PPML)', 1);
