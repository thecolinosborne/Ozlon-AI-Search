import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function getEnvVars() {
  const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN');
  const META_AD_ACCOUNT_ID = Deno.env.get('META_AD_ACCOUNT_ID');
  const META_APP_ID = Deno.env.get('META_APP_ID');
  const META_API_VERSION = Deno.env.get('META_API_VERSION') || 'v21.0';

  const missing: string[] = [];
  if (!META_ACCESS_TOKEN) missing.push('META_ACCESS_TOKEN');
  if (!META_AD_ACCOUNT_ID) missing.push('META_AD_ACCOUNT_ID');
  if (!META_APP_ID) missing.push('META_APP_ID');

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  return { META_ACCESS_TOKEN: META_ACCESS_TOKEN!, META_AD_ACCOUNT_ID: META_AD_ACCOUNT_ID!, META_APP_ID: META_APP_ID!, META_API_VERSION };
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 1): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || i === retries || res.status < 500) return res;
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Fetch failed after retries');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, data } = await req.json();
    const env = getEnvVars();
    const baseUrl = `https://graph.facebook.com/${env.META_API_VERSION}`;

    // --- TEST ---
    if (action === 'test') {
      const res = await fetchWithRetry(
        `${baseUrl}/me?access_token=${env.META_ACCESS_TOKEN}`,
        { method: 'GET' }
      );
      const body = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ success: false, error: body.error?.message || 'Unknown error' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Verify ad account access
      const acctRes = await fetchWithRetry(
        `${baseUrl}/act_${env.META_AD_ACCOUNT_ID}?fields=name,account_status&access_token=${env.META_ACCESS_TOKEN}`,
        { method: 'GET' }
      );
      const acctBody = await acctRes.json();

      return new Response(JSON.stringify({
        success: acctRes.ok,
        user: body,
        adAccount: acctRes.ok ? acctBody : null,
        error: acctRes.ok ? null : acctBody.error?.message,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- SYNC ---
    if (action === 'sync') {
      // Fetch campaigns
      const campRes = await fetchWithRetry(
        `${baseUrl}/act_${env.META_AD_ACCOUNT_ID}/campaigns?fields=id,name,status,objective&limit=100&access_token=${env.META_ACCESS_TOKEN}`,
        { method: 'GET' }
      );
      const campBody = await campRes.json();
      if (!campRes.ok) {
        return new Response(JSON.stringify({ success: false, error: campBody.error?.message || 'Failed to fetch campaigns' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch account-level insights (last 30 days, broken down by campaign)
      const insightsRes = await fetchWithRetry(
        `${baseUrl}/act_${env.META_AD_ACCOUNT_ID}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr,reach&level=campaign&date_preset=last_30d&limit=500&access_token=${env.META_ACCESS_TOKEN}`,
        { method: 'GET' }
      );
      const insightsBody = await insightsRes.json();

      // Merge campaigns with insights
      const insightsMap = new Map<string, any>();
      if (insightsRes.ok && insightsBody.data) {
        for (const row of insightsBody.data) {
          insightsMap.set(row.campaign_id, row);
        }
      }

      const normalized = (campBody.data || []).map((c: any) => {
        const insight = insightsMap.get(c.id) || {};
        return {
          campaign_id: c.id,
          campaign_name: c.name,
          status: c.status,
          objective: c.objective,
          spend: parseFloat(insight.spend || '0'),
          impressions: parseInt(insight.impressions || '0', 10),
          clicks: parseInt(insight.clicks || '0', 10),
          cpc: parseFloat(insight.cpc || '0'),
          ctr: parseFloat(insight.ctr || '0'),
          reach: parseInt(insight.reach || '0', 10),
          date_start: insight.date_start || null,
          date_stop: insight.date_stop || null,
          raw_json: { campaign: c, insight },
        };
      });

      return new Response(JSON.stringify({ success: true, campaigns: normalized, count: normalized.length }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- STORE ---
    if (action === 'store') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const token = authHeader.replace('Bearer ', '');
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const userId = claimsData.claims.sub;

      const campaigns = data?.campaigns || [];
      if (campaigns.length === 0) {
        return new Response(JSON.stringify({ success: true, stored: 0 }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Delete old data for this user, then insert fresh
      await supabase.from('facebook_ads_cache').delete().eq('user_id', userId);

      const rows = campaigns.map((c: any) => ({
        user_id: userId,
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        status: c.status,
        objective: c.objective,
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        cpc: c.cpc,
        ctr: c.ctr,
        reach: c.reach,
        date_start: c.date_start,
        date_stop: c.date_stop,
        raw_json: c.raw_json,
        synced_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase.from('facebook_ads_cache').insert(rows);
      if (insertError) {
        return new Response(JSON.stringify({ success: false, error: insertError.message }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, stored: rows.length }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use: test, sync, store' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('facebook-ads-sync error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
