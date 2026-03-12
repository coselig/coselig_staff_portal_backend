-- Add power supply options table for admin management
CREATE TABLE IF NOT EXISTS power_supply_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  wattage REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('UHP', 'HLG')),
  input_voltage INTEGER NOT NULL CHECK (input_voltage IN (110, 220)),
  supports_both_inputs INTEGER NOT NULL DEFAULT 0 CHECK (supports_both_inputs IN (0, 1)),
  price REAL NOT NULL DEFAULT 0.0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_power_supply_options_type ON power_supply_options(type);
CREATE INDEX IF NOT EXISTS idx_power_supply_options_input ON power_supply_options(input_voltage);

INSERT OR IGNORE INTO power_supply_options (name, wattage, type, input_voltage, price) VALUES
('UHP-100-110', 100, 'UHP', 110, 0.0),
('HLG-100-220', 100, 'HLG', 220, 0.0);
