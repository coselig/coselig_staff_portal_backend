-- 添加主題模式欄位到 users 表
ALTER TABLE users ADD COLUMN theme_mode TEXT DEFAULT 'system';