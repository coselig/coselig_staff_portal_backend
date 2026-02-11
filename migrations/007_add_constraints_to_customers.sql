-- Migration to add foreign key constraints and unique constraints to customers table
-- This prevents duplicate customer records and ensures data integrity

-- Add unique constraint to user_id to prevent duplicate customer records for the same user
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_user_id_unique ON customers(user_id);

-- Note: SQLite doesn't support adding foreign key constraints to existing tables via ALTER TABLE
-- The foreign key constraint should be defined in the table creation script
-- For existing data, we'll rely on application logic to maintain integrity