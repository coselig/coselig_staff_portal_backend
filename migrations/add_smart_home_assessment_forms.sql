CREATE TABLE IF NOT EXISTS smart_home_assessment_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  form_data TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')))
);

CREATE INDEX IF NOT EXISTS idx_smart_home_assessment_forms_user_id
  ON smart_home_assessment_forms(user_id);
