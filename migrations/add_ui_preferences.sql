-- Add UI preferences columns to users table
ALTER TABLE users ADD COLUMN font_size_scale REAL DEFAULT 1.0;
ALTER TABLE users ADD COLUMN show_working_staff_card INTEGER DEFAULT 1;
