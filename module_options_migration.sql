-- Create module_options table for quotation system
CREATE TABLE IF NOT EXISTS module_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL UNIQUE,
  channel_count INTEGER NOT NULL,
  is_dimmable INTEGER NOT NULL
);

-- Insert predefined module options
INSERT OR IGNORE INTO module_options (model, channel_count, is_dimmable) VALUES
('P210', 2, 1),
('P404', 4, 1),
('R410', 4, 0),
('P805', 8, 1),
('P305', 3, 1);