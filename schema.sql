CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee', -- employee, manager, boss
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'period1',
  check_in_time TEXT,
  check_out_time TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, work_date, period)
);

-- 裝置管理表
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,        -- 品牌 (sunwave, guo)
  model TEXT NOT NULL,        -- 型號 (p404, p210, U4, etc.)
  type TEXT NOT NULL,         -- 類型 (dual, single, wrgb, rgb, relay)
  module_id TEXT NOT NULL,    -- 模組ID
  channel TEXT NOT NULL,      -- 通道 (1, 2, 3, 4, a, b, x)
  name TEXT NOT NULL,         -- 裝置名稱
  tcp TEXT,                   -- TCP 配置 (可選)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(module_id, channel)  -- 模組ID和通道的組合必須唯一
);

-- 設備配置表
CREATE TABLE IF NOT EXISTS device_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,   -- 關聯到用戶
  name TEXT NOT NULL,         -- 配置名稱
  devices TEXT NOT NULL,      -- JSON 格式的設備列表
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)       -- 用戶的配置名稱必須唯一
);
