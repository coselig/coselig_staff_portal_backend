-- Migration to move project-related fields from customers to quote_configurations
-- This allows each quote to have its own project information

-- Step 1: Add project fields to quote_configurations table
ALTER TABLE quote_configurations ADD COLUMN project_name TEXT;
ALTER TABLE quote_configurations ADD COLUMN project_address TEXT;

-- Step 2: Copy project data from customers to quote_configurations
-- For each customer, update their associated quotes with the project info
UPDATE quote_configurations
SET project_name = (
  SELECT c.project_name
  FROM customers c
  WHERE c.id = quote_configurations.customer_id
),
project_address = (
  SELECT c.project_address
  FROM customers c
  WHERE c.id = quote_configurations.customer_id
)
WHERE customer_id IS NOT NULL;

-- Step 3: Remove project fields from customers table
-- Create new customers table without project fields
CREATE TABLE customers_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company TEXT, -- 公司名稱 (customer-specific)
  contact_person TEXT, -- 聯繫人 (customer-specific)
  notes TEXT, -- 備註 (customer-specific)
  is_active INTEGER DEFAULT 1, -- 是否活躍客戶
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Step 4: Copy data from old customers table to new table (excluding project fields)
INSERT INTO customers_new (
  id, user_id, company, contact_person, notes, is_active, created_at, updated_at
)
SELECT
  id, user_id, company, contact_person, notes, is_active, created_at, updated_at
FROM customers;

-- Step 5: Drop the old customers table
DROP TABLE customers;

-- Step 6: Rename the new table
ALTER TABLE customers_new RENAME TO customers;

-- Step 7: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);