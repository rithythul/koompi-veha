CREATE TABLE IF NOT EXISTS board_alerts (
    id TEXT PRIMARY KEY,
    board_id TEXT,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    message TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged_at TEXT,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_board_alerts_board_id ON board_alerts(board_id);
CREATE INDEX IF NOT EXISTS idx_board_alerts_acknowledged ON board_alerts(acknowledged);
