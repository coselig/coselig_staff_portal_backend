-- Switch options for the quotation system
CREATE TABLE IF NOT EXISTS switch_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0.0,
  count INTEGER NOT NULL DEFAULT 1,
  fire_type TEXT NOT NULL DEFAULT '',
  networkable INTEGER NOT NULL DEFAULT 0,
  protocol TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- Updated schema based on Cloudflare D1 database

CREATE TABLE IF NOT EXISTS device_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  devices TEXT NOT NULL,
  case_id INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, -- 關聯到用戶表，獲取基本信息
  company TEXT, -- 公司名稱 (客戶特有)
  contact_person TEXT, -- 聯繫人 (客戶特有)
  notes TEXT, -- 備註 (客戶特有)
  is_active INTEGER DEFAULT 1, -- 是否活躍客戶
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Quote configurations for the estimation system
CREATE TABLE IF NOT EXISTS quote_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  quote_data TEXT NOT NULL,
  customer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  project_name TEXT, -- 項目名稱 (quote-specific)
  project_address TEXT, -- 項目地址 (quote-specific)
  is_published INTEGER NOT NULL DEFAULT 0, -- 是否已發送給客戶
  sent_at TEXT, -- 發送時間
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Smart home assessment forms for staff
CREATE TABLE IF NOT EXISTS smart_home_assessment_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  form_data TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')))
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

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);
CREATE INDEX IF NOT EXISTS idx_quote_configurations_customer_user_id ON quote_configurations(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_smart_home_assessment_forms_user_id ON smart_home_assessment_forms(user_id);

-- Index to speed up lookups by case
CREATE INDEX IF NOT EXISTS idx_device_configurations_case_id ON device_configurations(case_id);

-- Module options for the quotation system
CREATE TABLE IF NOT EXISTS module_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL DEFAULT '',
  channel_count INTEGER NOT NULL,
  is_dimmable INTEGER NOT NULL,
  max_ampere_per_channel REAL NOT NULL DEFAULT 0.0,
  max_ampere_total REAL NOT NULL DEFAULT 0.0,
  price REAL NOT NULL DEFAULT 0.0
);

-- Insert predefined module options with ampere values
INSERT OR IGNORE INTO module_options (model, brand, channel_count, is_dimmable, max_ampere_per_channel, max_ampere_total, price) VALUES
('P210', '', 2, 1, 5.0, 10.0, 0.0),
('P404', '', 4, 1, 5.0, 20.0, 0.0),
('R410', '', 4, 0, 5.0, 20.0, 0.0),
('P805', '', 8, 1, 5.0, 40.0, 0.0),
('P305', '', 3, 1, 5.0, 15.0, 0.0);

-- Power supply options for the quotation system
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

INSERT OR IGNORE INTO power_supply_options (name, wattage, type, input_voltage, supports_both_inputs, price) VALUES
('UHP-100-110', 100, 'UHP', 110, 0, 0.0),
('HLG-100-220', 100, 'HLG', 220, 0, 0.0);

-- Fixture type options for the quotation system
CREATE TABLE IF NOT EXISTS fixture_type_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL UNIQUE,
  quantity_label TEXT NOT NULL DEFAULT '燈具數量',
  unit_label TEXT NOT NULL DEFAULT '每顆瓦數 (W)',
  is_meter_based INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0.0,
  default_unit_watt INTEGER NOT NULL DEFAULT 0
);

-- Insert predefined fixture type options
INSERT OR IGNORE INTO fixture_type_options (type, quantity_label, unit_label, is_meter_based, price, default_unit_watt) VALUES
('軌道燈', '燈具數量', '每顆瓦數 (W)', 0, 0.0, 10),
('燈帶', '米數', '每米瓦數 (W/m)', 1, 0.0, 14),
('崁燈', '燈具數量', '每顆瓦數 (W)', 0, 0.0, 10),
('射燈', '燈具數量', '每顆瓦數 (W)', 0, 0.0, 7),
('吊燈', '燈具數量', '每顆瓦數 (W)', 0, 0.0, 40);

-- Device config options for the discovery generator
CREATE TABLE IF NOT EXISTS device_config_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  types TEXT NOT NULL DEFAULT '[]',
  channels TEXT NOT NULL DEFAULT '{}',
  channel_map TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))),
  UNIQUE(brand, model)
);

-- Insert predefined device config options
INSERT OR IGNORE INTO device_config_options (brand, model, types, channels, channel_map) VALUES
('sunwave', 'p404', '["dual","single","rgb"]', '{"dual":["a","b"],"single":["1","2","3","4"],"rgb":["x"]}', '{"a":["1","2"],"b":["3","4"],"x":["1","2","3"]}'),
('sunwave', 'p210', '["dual","single"]', '{"dual":["a"],"single":["1","2"]}', '{"a":["1","2"]}'),
('sunwave', 'U4', '["dual","single","rgb"]', '{"dual":["a","b"],"single":["1","2","3","4"],"rgb":["x"]}', '{"a":["1","2"],"b":["3","4"],"x":["1","2","3"]}'),
('sunwave', 'R8A', '["relay"]', '{"relay":["1","2","3","4","5","6","7","8"]}', '{}'),
('sunwave', 'R410', '["relay"]', '{"relay":["1","2","3","4"]}', '{}'),
('guo', 'p805', '["dual","single","rgbw"]', '{"dual":["a","b","c","d"],"single":["1","2","3","4","5","6","7","8"],"rgbw":["x","y"]}', '{"a":["1","2"],"b":["3","4"],"c":["5","6"],"d":["7","8"],"x":["1","2","3","4"],"y":["5","6","7","8"]}'),
('guo', 'p305', '["dual","single"]', '{"dual":["a"],"single":["1","2","3"]}', '{"a":["1","2"]}');
