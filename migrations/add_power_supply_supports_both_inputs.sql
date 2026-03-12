-- Support dual-input (110/220) power supply models
ALTER TABLE power_supply_options
ADD COLUMN supports_both_inputs INTEGER NOT NULL DEFAULT 0 CHECK (supports_both_inputs IN (0, 1));
