-- Add ampere columns to module_options table
ALTER TABLE module_options ADD COLUMN max_ampere_per_channel REAL NOT NULL DEFAULT 0.0;
ALTER TABLE module_options ADD COLUMN max_ampere_total REAL NOT NULL DEFAULT 0.0;

-- Update existing module options with ampere values
UPDATE module_options SET max_ampere_per_channel = 5.0, max_ampere_total = 10.0 WHERE model = 'P210';
UPDATE module_options SET max_ampere_per_channel = 5.0, max_ampere_total = 15.0 WHERE model = 'P305';
UPDATE module_options SET max_ampere_per_channel = 5.0, max_ampere_total = 20.0 WHERE model = 'P404';
UPDATE module_options SET max_ampere_per_channel = 5.0, max_ampere_total = 40.0 WHERE model = 'P805';
UPDATE module_options SET max_ampere_per_channel = 5.0, max_ampere_total = 20.0 WHERE model = 'R410';