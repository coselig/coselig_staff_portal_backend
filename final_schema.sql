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