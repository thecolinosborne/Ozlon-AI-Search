import { useState } from "react";
import { Facebook } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const FacebookAdsDetail = () => {
  const { getIntegration, setStatus, setSyncDirection, setLastSync } = useIntegrationsStore();
  const integration = getIntegration("facebook-ads");
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [campaignCount, setCampaignCount] = useState<number | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-ads-sync", {
        body: { action: "test" },
      });
      if (error) throw error;
      setTestResult(data);
      if (data.success) {
        setStatus("facebook-ads", "connected");
        toast.success("Meta API connection verified");
      } else {
        setStatus("facebook-ads", "error");
        toast.error(data.error || "Connection test failed");
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
      setStatus("facebook-ads", "error");
      toast.error("Test failed: " + err.message);
    } finally {
      setTesting(false);
    }
  };

  const syncAds = async () => {
    setSyncing(true);
    setStatus("facebook-ads", "syncing");
    try {
      // Step 1: Fetch from Meta
      const { data: syncData, error: syncError } = await supabase.functions.invoke("facebook-ads-sync", {
        body: { action: "sync" },
      });
      if (syncError) throw syncError;
      if (!syncData.success) throw new Error(syncData.error);

      setCampaignCount(syncData.count);

      // Step 2: Store in database
      const { data: storeData, error: storeError } = await supabase.functions.invoke("facebook-ads-sync", {
        body: { action: "store", data: { campaigns: syncData.campaigns } },
      });
      if (storeError) throw storeError;
      if (!storeData.success) throw new Error(storeData.error);

      setStatus("facebook-ads", "connected");
      setLastSync("facebook-ads", new Date().toISOString());
      toast.success(`Synced ${syncData.count} campaigns`);
    } catch (err: any) {
      setStatus("facebook-ads", "error");
      toast.error("Sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <IntegrationDetailLayout
      name="Facebook Ads"
      description="Meta Marketing API — campaigns, ad sets, and performance metrics"
      icon={Facebook}
      status={integration.status}
      actions={
        <>
          <button
            onClick={runTest}
            disabled={testing}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-xl transition-all",
              "bg-muted/60 text-foreground hover:bg-muted",
              testing && "opacity-50 cursor-not-allowed"
            )}
          >
            {testing ? "Testing…" : "Run Test"}
          </button>
          <button
            onClick={syncAds}
            disabled={syncing}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-xl transition-all",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              syncing && "opacity-50 cursor-not-allowed"
            )}
          >
            {syncing ? "Syncing…" : "Sync Ads Data"}
          </button>
        </>
      }
    >
      {/* Status Card */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Connection Status</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Status</p>
            <p className="font-medium text-foreground capitalize">{integration.status}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Campaigns</p>
            <p className="font-medium text-foreground">{campaignCount ?? "—"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-muted-foreground text-xs">Last Sync</p>
            <p className="font-medium text-foreground">
              {integration.lastSync ? new Date(integration.lastSync).toLocaleString() : "Never"}
            </p>
          </div>
        </div>
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={cn(
          "p-4 rounded-2xl border text-sm space-y-2",
          testResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
        )}>
          <h3 className="font-medium text-foreground">
            {testResult.success ? "✓ Test Passed" : "✗ Test Failed"}
          </h3>
          {testResult.user && (
            <p className="text-muted-foreground text-xs">User: {testResult.user.name || testResult.user.id}</p>
          )}
          {testResult.adAccount && (
            <p className="text-muted-foreground text-xs">Ad Account: {testResult.adAccount.name}</p>
          )}
          {testResult.error && (
            <p className="text-destructive text-xs">{testResult.error}</p>
          )}
        </div>
      )}

      {/* Sync Control */}
      <SyncControl
        direction={integration.syncDirection}
        onDirectionChange={(d) => setSyncDirection("facebook-ads", d)}
        lastSync={integration.lastSync}
        onSync={syncAds}
        syncing={syncing}
      />
    </IntegrationDetailLayout>
  );
};

export default FacebookAdsDetail;
