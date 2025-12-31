-- Migration to update devices table: remove UNIQUE from module_id, add UNIQUE on (module_id, channel)

-- First, backup existing data
CREATE TABLE devices_backup AS SELECT * FROM devices;

-- Drop the old table
DROP TABLE devices;

-- Recreate with new schema
CREATE TABLE devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  type TEXT NOT NULL,
  module_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  name TEXT NOT NULL,
  tcp TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(module_id, channel)
);

-- Restore data
INSERT INTO devices (id, brand, model, type, module_id, channel, name, tcp, created_at, updated_at)
SELECT id, brand, model, type, module_id, channel, name, tcp, created_at, updated_at
FROM devices_backup;

-- Drop backup
DROP TABLE devices_backup;