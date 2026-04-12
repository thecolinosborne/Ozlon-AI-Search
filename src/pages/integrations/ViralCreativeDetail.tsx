import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Sparkles, Zap, Target, BarChart3, RefreshCw, Package, Loader2, AlertCircle } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook_ads", label: "Facebook Ads" },
  { value: "reels", label: "Reels" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube_thumbnails", label: "YouTube Thumbnails" },
  { value: "landing_page", label: "Landing Page" },
  { value: "ecommerce", label: "E-commerce" },
];

const GOALS = [
  { value: "awareness", label: "Awareness" },
  { value: "conversion", label: "Conversion" },
  { value: "engagement", label: "Engagement" },
  { value: "retargeting", label: "Retargeting" },
];

const ViralCreativeDetail = () => {
  const { toast } = useToast();
  const { getIntegration, setStatus, setApiKeyConfigured, setLastSync } = useIntegrationsStore();
  const integration = getIntegration("viral-creative");
  const higgsfield = getIntegration("higgsfield");

  const [requestText, setRequestText] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [contentGoal, setContentGoal] = useState("conversion");

  const [angles, setAngles] = useState<any[]>([]);
  const [hooks, setHooks] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [scores, setScores] = useState<any>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  // Auto-detect on mount — check both Viral Creative and Higgsfield
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("viral-creative", {
          body: { action: "test_connection" },
        });
        if (error) throw error;
        if (data?.success) {
          setStatus("viral-creative", "connected");
          setApiKeyConfigured("viral-creative", true);
        } else {
          setStatus("viral-creative", "disconnected");
        }
      } catch {
        setStatus("viral-creative", "disconnected");
      }
    };

    const checkHiggsfield = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("higgsfield", {
          body: { action: "test_connection" },
        });
        if (!error && data?.success) {
          setStatus("higgsfield", "connected");
          setApiKeyConfigured("higgsfield", true);
        }
      } catch {
        // Higgsfield check is best-effort
      }
    };

    checkConnection();
    checkHiggsfield();
  }, []);

  const callAction = useCallback(async (action: string, params: Record<string, unknown>) => {
    setLoading(action);
    try {
      const { data, error } = await supabase.functions.invoke("viral-creative", {
        body: { action, ...params },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Action failed");
      return data.data;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      return null;
    } finally {
      setLoading(null);
    }
  }, [toast]);

  const handleGenerateAngles = async () => {
    const result = await callAction("analyze_angles", {
      request_text: requestText,
      source_context: {},
      platform,
      content_goal: contentGoal,
    });
    if (result) {
      const arr = Array.isArray(result) ? result : [];
      setAngles(arr);
      toast({ title: "Angles Generated", description: `${arr.length} angles discovered` });
    }
  };

  const handleExtractHooks = async () => {
    const result = await callAction("extract_hooks", {
      angles,
      request_text: requestText,
      platform,
    });
    if (result) {
      const arr = Array.isArray(result) ? result : [];
      setHooks(arr);
      toast({ title: "Hooks Extracted", description: `${arr.length} hooks generated` });
    }
  };

  const handleGeneratePrompts = async () => {
    const result = await callAction("generate_prompts", {
      angles,
      hooks,
      platform,
      content_goal: contentGoal,
      request_text: requestText,
    });
    if (result) {
      const arr = Array.isArray(result) ? result : [];
      setPrompts(arr);
      toast({ title: "Prompts Generated", description: `${arr.length} Higgsfield prompts ready` });
    }
  };

  const handleScoreConcepts = async () => {
    const result = await callAction("score_concepts", {
      prompt_candidates: prompts,
      platform,
      content_goal: contentGoal,
    });
    if (result) {
      setScores(result);
      toast({ title: "Scoring Complete", description: "Prompts ranked by performance potential" });
    }
  };

  const handleFullPipeline = async () => {
    if (!requestText.trim()) {
      toast({ title: "Enter a campaign goal", variant: "destructive" });
      return;
    }
    setLoading("full_pipeline");
    try {
      const { data, error } = await supabase.functions.invoke("viral-creative", {
        body: {
          action: "full_pipeline",
          request_text: requestText,
          source_context: {},
          platform,
          content_goal: contentGoal,
          reference_text: referenceText || null,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Pipeline failed");
      const d = data.data;
      setAngles(Array.isArray(d.angles) ? d.angles : []);
      setHooks(Array.isArray(d.hooks) ? d.hooks : []);
      setPrompts(Array.isArray(d.prompt_candidates) ? d.prompt_candidates : []);
      setScores(d.score_data || null);
      setPackages(Array.isArray(d.output_packages?.packages) ? d.output_packages.packages : Array.isArray(d.output_packages) ? d.output_packages : []);
      setLastSync("viral-creative", new Date().toISOString());
      toast({ title: "Full Pipeline Complete", description: "Angles, hooks, prompts, and scores generated" });
    } catch (err: any) {
      toast({ title: "Pipeline Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  };

  const isConnected = integration.status === "connected";

  return (
    <IntegrationDetailLayout
      name="Viral Creative Intelligence"
      description="AI-powered creative strategy & prompt optimization for Higgsfield"
      icon={Brain}
      status={integration.status}
    >
      {!isConnected && (
        <div className="p-4 rounded-xl border border-border/40 bg-muted/30 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Connecting to AI gateway...</p>
        </div>
      )}

      {isConnected && (
        <div className="space-y-6">
          {/* Higgsfield status */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="w-4 h-4" />
            Higgsfield: <Badge variant={higgsfield.status === "connected" ? "default" : "secondary"}>
              {higgsfield.status === "connected" ? "Connected" : "Not Connected"}
            </Badge>
          </div>

          {/* Campaign Input */}
          <div className="space-y-4 p-5 rounded-xl border border-border/40 bg-card/60">
            <h3 className="text-sm font-semibold text-foreground">Campaign Brief</h3>
            <Textarea
              placeholder="Describe your offer, product, or campaign goal..."
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              className="min-h-[100px]"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Platform</label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Content Goal</label>
                <Select value={contentGoal} onValueChange={setContentGoal}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GOALS.map(g => (
                      <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Textarea
              placeholder="Paste competitor URLs, reference content, or inspiration notes (optional)..."
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              className="min-h-[60px]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleFullPipeline} disabled={!!loading || !requestText.trim()} className="gap-2">
              {loading === "full_pipeline" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Full Pipeline
            </Button>
            <Button variant="outline" onClick={handleGenerateAngles} disabled={!!loading || !requestText.trim()} className="gap-2">
              {loading === "analyze_angles" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              Generate Angles
            </Button>
            <Button variant="outline" onClick={handleExtractHooks} disabled={!!loading || angles.length === 0} className="gap-2">
              {loading === "extract_hooks" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Extract Hooks
            </Button>
            <Button variant="outline" onClick={handleGeneratePrompts} disabled={!!loading || angles.length === 0} className="gap-2">
              {loading === "generate_prompts" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              Generate Prompts
            </Button>
            <Button variant="outline" onClick={handleScoreConcepts} disabled={!!loading || prompts.length === 0} className="gap-2">
              {loading === "score_concepts" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              Score & Rank
            </Button>
          </div>

          {/* Results Tabs */}
          {(angles.length > 0 || hooks.length > 0 || prompts.length > 0) && (
            <Tabs defaultValue="angles" className="w-full">
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="angles">Angles ({angles.length})</TabsTrigger>
                <TabsTrigger value="hooks">Hooks ({hooks.length})</TabsTrigger>
                <TabsTrigger value="prompts">Prompts ({prompts.length})</TabsTrigger>
                <TabsTrigger value="packages">Packages ({packages.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="angles" className="space-y-3 mt-4">
                {angles.map((a: any, i: number) => (
                  <div key={i} className="p-4 rounded-xl border border-border/40 bg-card/60 space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{a.name || `Angle ${i + 1}`}</h4>
                      <Badge variant="secondary" className="text-[10px]">{a.type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{a.description}</p>
                    {a.example_headline && (
                      <p className="text-xs text-foreground/70 italic">"{a.example_headline}"</p>
                    )}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="hooks" className="space-y-3 mt-4">
                {hooks.map((h: any, i: number) => (
                  <div key={i} className="p-4 rounded-xl border border-border/40 bg-card/60 space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{h.hook_text || `Hook ${i + 1}`}</h4>
                      <Badge variant="secondary" className="text-[10px]">{h.hook_type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{h.visual_concept}</p>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="prompts" className="space-y-3 mt-4">
                {prompts.map((p: any, i: number) => {
                  const scoreEntry = scores?.scores?.find((s: any) => s.prompt_index === i);
                  return (
                    <div key={i} className="p-4 rounded-xl border border-border/40 bg-card/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-foreground">{p.angle_name || `Prompt ${i + 1}`}</h4>
                        {scoreEntry && (
                          <Badge variant="default" className="text-[10px]">
                            Score: {scoreEntry.total_score}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-foreground/80 font-mono bg-muted/40 p-2 rounded">{p.prompt_text}</p>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">{p.style}</Badge>
                        <Badge variant="outline" className="text-[10px]">{p.visual_emotion}</Badge>
                      </div>
                      {scoreEntry && (
                        <div className="grid grid-cols-4 gap-1 mt-2">
                          {Object.entries(scoreEntry.dimensions || {}).map(([key, val]) => (
                            <div key={key} className="text-center">
                              <div className="text-[10px] text-muted-foreground">{key.replace(/_/g, " ")}</div>
                              <div className="text-xs font-semibold text-foreground">{val as number}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="packages" className="space-y-3 mt-4">
                {packages.map((pkg: any, i: number) => (
                  <div key={i} className="p-4 rounded-xl border border-border/40 bg-card/60 space-y-2">
                    <h4 className="text-sm font-semibold text-foreground">{pkg.title || `Package ${i + 1}`}</h4>
                    <div className="space-y-1 text-xs">
                      <p><span className="text-muted-foreground">Angle:</span> {pkg.angle_name}</p>
                      <p><span className="text-muted-foreground">Hook:</span> {pkg.hook_line}</p>
                      <p><span className="text-muted-foreground">Caption:</span> {pkg.caption_suggestion}</p>
                      <p><span className="text-muted-foreground">CTA:</span> {pkg.cta_suggestion}</p>
                      <p><span className="text-muted-foreground">Platform:</span> {pkg.recommended_platform}</p>
                      <p><span className="text-muted-foreground">Use case:</span> {pkg.recommended_use_case}</p>
                    </div>
                    <p className="text-xs text-foreground/80 font-mono bg-muted/40 p-2 rounded">{pkg.prompt_text}</p>
                  </div>
                ))}
                {packages.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">Run Full Pipeline to see output packages</p>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      )}
    </IntegrationDetailLayout>
  );
};

export default ViralCreativeDetail;
