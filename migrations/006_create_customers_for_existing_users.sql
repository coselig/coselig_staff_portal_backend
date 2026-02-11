-- Script to create customer records for existing users with role 'customer'
-- This ensures all customer users have corresponding entries in the customers table

INSERT OR IGNORE INTO customers (user_id, name, email)
SELECT id, name, email
FROM users
WHERE role = 'customer'
AND id NOT IN (SELECT user_id FROM customers WHERE user_id IS NOT NULL);