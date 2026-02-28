
-- Key/value settings table for app configuration
CREATE TABLE public.app_settings (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Allow public read/write since there's no auth in this app
CREATE POLICY "Allow public read" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON public.app_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON public.app_settings FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON public.app_settings FOR DELETE USING (true);
