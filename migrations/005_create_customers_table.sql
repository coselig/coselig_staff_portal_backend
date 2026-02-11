-- Migration to create customers table
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, -- 關聯到創建此客戶記錄的用戶
  name TEXT NOT NULL, -- 客戶姓名
  chinese_name TEXT, -- 中文名稱
  company TEXT, -- 公司名稱
  email TEXT, -- 電子郵件
  phone TEXT, -- 聯繫電話
  address TEXT, -- 地址
  project_name TEXT, -- 項目名稱
  project_address TEXT, -- 項目地址
  contact_person TEXT, -- 聯繫人
  notes TEXT, -- 備註
  is_active INTEGER DEFAULT 1, -- 是否活躍客戶
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);