-- Migration to refactor customers table to avoid duplication with users table
-- Since D1 doesn't support ALTER TABLE well, we'll recreate the table

-- Step 1: Create a temporary table with the new structure
CREATE TABLE customers_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company TEXT, -- 公司名稱 (customer-specific)
  project_name TEXT, -- 項目名稱 (customer-specific)
  project_address TEXT, -- 項目地址 (customer-specific)
  contact_person TEXT, -- 聯繫人 (customer-specific)
  notes TEXT, -- 備註 (customer-specific)
  is_active INTEGER DEFAULT 1, -- 是否活躍客戶
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Copy data from old table to new table (only non-duplicate fields)
INSERT INTO customers_new (
  id, user_id, company, project_name, project_address,
  contact_person, notes, is_active, created_at, updated_at
)
SELECT
  id, user_id, company, project_name, project_address,
  contact_person, notes, is_active, created_at, updated_at
FROM customers;

-- Step 3: Drop the old table
DROP TABLE customers;

-- Step 4: Rename the new table
ALTER TABLE customers_new RENAME TO customers;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);