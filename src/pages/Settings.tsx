import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mic,
  LogOut,
  ArrowLeft,
  Edit3,
  Trash2,
  Volume2,
  PlayCircle,
  Phone,
  Plug,
  Sparkles,
  Brain,
  Wand2,
} from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SegmentedControl } from "@/components/settings/SegmentedControl";
import { ProfileHeroCard } from "@/components/settings/ProfileHeroCard";
import { WisdomLibraryCard } from "@/components/settings/WisdomLibraryCard";
import { useAppStore } from "@/stores/useAppStore";
import { supabase } from "@/integrations/supabase/client";
import { localDb } from "@/services/localDb";
import { toast } from "sonner";
import { voiceService, VoiceSettings } from "@/services/voiceService";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const Settings = () => {
  const navigate = useNavigate();
  const { user: storeUser, updateUser, reset, clearMessages: clearStoreMessages } = useAppStore();
  const { authLoading, session, user: authUser, systemName, signOut, voiceEnabled, setVoiceEnabled } = useAuth();
  const isAuthenticated = !!session && !!authUser;

  const [profileName, setProfileName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [osName, setOsName] = useState(systemName);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [showClearChatDialog, setShowClearChatDialog] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [isLoadingVoice, setIsLoadingVoice] = useState(false);
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);

  const communicationMode = storeUser?.communicationMode || "both";

  useEffect(() => {
    setOsName(systemName);
  }, [systemName]);

  useEffect(() => {
    if (!authUser) {
      setProfileName(null);
      setAvatarUrl(null);
      return;
    }
    const fetchProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("user_id", authUser.id)
        .maybeSingle();
      setProfileName(data?.full_name || null);
      setAvatarUrl(data?.avatar_url || null);
    };
    fetchProfile();
  }, [authUser]);

  useEffect(() => {
    const loadVoiceSettings = async () => {
      if (!authUser) return;
      try {
        const { settings } = await voiceService.getSettings();
        setVoiceSettings(settings);
      } catch (error) {
        console.error("Failed to load voice settings:", error);
      }
    };
    loadVoiceSettings();
  }, [authUser]);

  const isSignedIn = !!session && !!authUser;
  const displayName = isSignedIn
    ? profileName || authUser?.user_metadata?.full_name || authUser?.email?.split("@")[0] || "User"
    : "Guest";

  const handleLogout = async () => {
    reset();
    await signOut();
    navigate("/");
  };

  const handleClearChat = async () => {
    try {
      await localDb.clearMessages();
      clearStoreMessages();
      toast.success("Chat history cleared");
      setShowClearChatDialog(false);
    } catch (error) {
      toast.error("Failed to clear chat history");
    }
  };

  const handleCommunicationChange = (mode: "text" | "voice" | "both") => {
    updateUser({ communicationMode: mode });
    localStorage.setItem("ozlon_communication_mode", mode);
  };

  const handleAutoPlayToggle = async (enabled: boolean) => {
    if (!voiceSettings) return;
    setIsLoadingVoice(true);
    try {
      const updated = await voiceService.updateSettings({ auto_play_responses: enabled });
      setVoiceSettings((prev) => (prev ? { ...prev, ...updated } : null));
      toast.success(enabled ? "Auto-play enabled" : "Auto-play disabled");
    } catch (error) {
      toast.error("Failed to update voice settings");
    } finally {
      setIsLoadingVoice(false);
    }
  };

  const handlePreviewVoice = async () => {
    setIsPreviewingVoice(true);
    try {
      await voiceService.previewVoice();
    } catch (error) {
      console.error("Voice preview failed:", error);
      toast.error("Failed to preview voice. Please try again.");
    } finally {
      setIsPreviewingVoice(false);
    }
  };

  const handleSaveOsName = async (newName: string) => {
    setOsName(newName);
    localStorage.setItem("ozlon_system_name", newName);
    if (authUser) {
      await supabase.from("profiles").update({ system_name: newName }).eq("user_id", authUser.id);
    }
    toast.success(`System renamed to ${newName}`);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-muted border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 pb-24">
      {/* Sticky header with backdrop blur */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur-xl px-4 py-4 safe-area-top">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-muted rounded-full transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-foreground">Settings</h1>
            <p className="text-[11px] text-muted-foreground font-mono uppercase tracking-[0.15em]">
              System configuration
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="rounded-full sm:hidden"
          >
            Done
          </Button>
        </div>
      </header>

      <div className="px-4 max-w-2xl mx-auto pt-6">
        {/* Profile hero */}
        <ProfileHeroCard
          isSignedIn={isSignedIn}
          displayName={displayName}
          email={authUser?.email}
          avatarUrl={avatarUrl}
        />

        {/* Personalization */}
        <SettingsSection title="Personalization">
          <SettingsRow
            icon={Edit3}
            label="Operating System Name"
            description="Personalize your assistant"
            type="inline-edit"
            editValue={osName}
            onEditSave={handleSaveOsName}
            editPlaceholder="Enter system name"
          />
          <SettingsRow
            icon={Brain}
            label="Brain Stones"
            description="Stones picked automatically. Swap lobes anytime."
            onClick={() => navigate("/settings/brain")}
          />
          <SettingsRow
            icon={Sparkles}
            label="Identity & Memory"
            description="Who your AI is, what it remembers, and the rules it obeys"
            onClick={() => navigate("/settings/identity")}
          />
          <SettingsRow
            icon={Wand2}
            label="Skills"
            description="Install and manage scoped workflows your AI can run"
            onClick={() => navigate("/skills")}
          />
        </SettingsSection>

        {/* Voice & Communication */}
        <SettingsSection title="Voice & Communication">
          <SettingsRow
            icon={Mic}
            label="Communication Mode"
            description="How you talk with the assistant"
            type="action"
            rightSlot={
              <SegmentedControl
                value={communicationMode}
                onChange={handleCommunicationChange}
                options={[
                  { value: "text", label: "Text" },
                  { value: "voice", label: "Voice" },
                  { value: "both", label: "Both" },
                ]}
              />
            }
          />
          <SettingsRow
            icon={Phone}
            label="Enable Voice Features"
            description={
              !isAuthenticated
                ? "Sign in to enable voice conversation"
                : voiceEnabled
                ? "Voice output active"
                : "Turn on to hear AI responses"
            }
            type="toggle"
            value={voiceEnabled}
            onChange={setVoiceEnabled}
            disabled={!isAuthenticated}
          />
          <SettingsRow
            icon={PlayCircle}
            label="Auto-play responses"
            description="Automatically play voice for AI responses"
            type="toggle"
            value={voiceSettings?.auto_play_responses ?? false}
            onChange={handleAutoPlayToggle}
            disabled={isLoadingVoice}
          />
          <SettingsRow
            icon={Volume2}
            label="Voice Preview"
            description="Aria — ElevenLabs voice"
            type="action"
            onClick={handlePreviewVoice}
            actionLabel={isPreviewingVoice ? "Playing…" : "Preview"}
            disabled={isPreviewingVoice}
          />
        </SettingsSection>

        {/* Wisdom Library — its own featured section */}
        <SettingsSection title="Wisdom Library" grouped={false}>
          <WisdomLibraryCard />
        </SettingsSection>

        {/* Integrations */}
        <SettingsSection title="Integrations">
          <SettingsRow
            icon={Plug}
            label="Manage Integrations"
            description="Connect and configure your tools"
            onClick={() => navigate("/integrations")}
          />
        </SettingsSection>

        {/* Data & Privacy */}
        <SettingsSection title="Data & Privacy">
          <SettingsRow
            icon={Trash2}
            label="Clear chat history"
            description="Delete all conversation history"
            type="action"
            onClick={() => setShowClearChatDialog(true)}
            destructive
            actionLabel="Clear"
          />
        </SettingsSection>

        {/* Account */}
        {isSignedIn && (
          <SettingsSection title="Account">
            <SettingsRow
              icon={LogOut}
              label="Sign out"
              description="Sign out of your account"
              type="action"
              onClick={() => setShowSignOutDialog(true)}
              destructive
              actionLabel="Sign out"
            />
          </SettingsSection>
        )}
      </div>

      <AlertDialog open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out? You'll need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showClearChatDialog} onOpenChange={setShowClearChatDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all your conversation history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearChat}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Settings;
