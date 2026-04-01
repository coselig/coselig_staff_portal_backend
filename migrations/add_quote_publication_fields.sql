ALTER TABLE quote_configurations ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quote_configurations ADD COLUMN sent_at TEXT;
