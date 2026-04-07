CREATE TABLE IF NOT EXISTS project_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')))
);

CREATE INDEX IF NOT EXISTS idx_project_cases_customer_id
  ON project_cases(customer_id);

CREATE INDEX IF NOT EXISTS idx_project_cases_created_by
  ON project_cases(created_by);

CREATE TABLE IF NOT EXISTS quote_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES project_cases(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  quote_data TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')))
);

CREATE INDEX IF NOT EXISTS idx_quote_snapshots_case_id
  ON quote_snapshots(case_id);
