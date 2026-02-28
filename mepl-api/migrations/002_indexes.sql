CREATE INDEX IF NOT EXISTS idx_boards_group_id ON boards(group_id);
CREATE INDEX IF NOT EXISTS idx_boards_status ON boards(status);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_at ON media(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists(created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_board_id ON schedules(board_id);
CREATE INDEX IF NOT EXISTS idx_schedules_group_id ON schedules(group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_playlist_id ON schedules(playlist_id);
CREATE INDEX IF NOT EXISTS idx_schedules_priority ON schedules(priority);
