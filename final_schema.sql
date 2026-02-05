-- Updated schema based on Cloudflare D1 database

CREATE TABLE IF NOT EXISTS device_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  devices TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Quote configurations for the estimation system
CREATE TABLE IF NOT EXISTS quote_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  quote_data TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Additional tables from Cloudflare metadata
CREATE TABLE IF NOT EXISTS period_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

-- Metadata table for Cloudflare Workers
CREATE TABLE IF NOT EXISTS _cf_METADATA (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Module options for the quotation system
CREATE TABLE IF NOT EXISTS module_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL UNIQUE,
  channel_count INTEGER NOT NULL,
  is_dimmable INTEGER NOT NULL,
  max_ampere_per_channel REAL NOT NULL DEFAULT 0.0,
  max_ampere_total REAL NOT NULL DEFAULT 0.0
);

-- Insert predefined module options with ampere values
INSERT OR IGNORE INTO module_options (model, channel_count, is_dimmable, max_ampere_per_channel, max_ampere_total) VALUES
('P210', 2, 1, 5.0, 10.0),
('P404', 4, 1, 5.0, 20.0),
('R410', 4, 0, 5.0, 20.0),
('P805', 8, 1, 5.0, 40.0),
('P305', 3, 1, 5.0, 15.0);