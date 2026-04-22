CREATE INDEX IF NOT EXISTS idx_integration_connections_slack_team
ON public.integration_connections ((metadata->>'team_id'))
WHERE provider = 'slack';