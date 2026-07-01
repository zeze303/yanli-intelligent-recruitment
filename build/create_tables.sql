-- 在 Supabase Dashboard > SQL Editor 中运行

-- 页面访问记录（UV 统计）
CREATE TABLE IF NOT EXISTS page_views (
  id BIGSERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT DEFAULT '',
  referer TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_views_ip ON page_views(ip);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);

-- 聊天记录
CREATE TABLE IF NOT EXISTS chat_logs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('yanli', 'admissions')),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  ip TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_created ON chat_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_source ON chat_logs(source);
