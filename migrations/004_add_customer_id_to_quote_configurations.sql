-- Migration to add customer_id to quote_configurations table
ALTER TABLE quote_configurations ADD COLUMN customer_id INTEGER REFERENCES customers(id);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_quote_configurations_customer_id ON quote_configurations(customer_id);