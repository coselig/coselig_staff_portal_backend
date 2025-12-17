CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,       -- session_id
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);