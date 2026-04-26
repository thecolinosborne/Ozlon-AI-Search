SELECT cron.schedule(
  'signals-tune-hourly',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iebmlegqknigeildujyp.supabase.co/functions/v1/scheduled-routines?mode=signals_tune_tick',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);