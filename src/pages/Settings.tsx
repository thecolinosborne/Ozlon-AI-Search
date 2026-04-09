import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  User,
  Mic,
  Type,
  Keyboard,
  Calendar,
  Mail,
  CreditCard,
  LogOut,
  Cpu,
  Brain,
  MessageSquare,
  Smile,
  Wallet,
  FileText,
  ArrowLeft,
  Edit3,
  Trash2,
  Volume2,
  PlayCircle,
  Phone,
} from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { MatonIntegrations } from "@/components/settings/MatonIntegrations";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { useAppStore } from "@/stores/useAppStore";
import { supabase } from "@/integrations/supabase/client";
import { localDb } from "@/services/localDb";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { voiceService, VoiceSettings, OZLON_DEFAULT_VOICE_ID } from "@/services/voiceService";
import { useAuth } from "@/contexts/AuthContext";
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
  const { user: storeUser, updateUser, connections, updateConnection, agents, toggleAgent, reset, clearMessages: clearStoreMessages } = useAppStore();
  const { authLoading, session, user: authUser, systemName, signOut, voiceEnabled, setVoiceEnabled } = useAuth();
  const isAuthenticated = !!session && !!authUser;
  
  // Profile name state
  const [profileName, setProfileName] = useState<string | null>(null);
  
  // OS Name state
  const [osName, setOsName] = useState(systemName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(systemName);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [showClearChatDialog, setShowClearChatDialog] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [isLoadingVoice, setIsLoadingVoice] = useState(false);
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);

  const communicationMode = storeUser?.communicationMode || "both";

  // Sync osName with systemName from auth context
  useEffect(() => {
    setOsName(systemName);
    setTempName(systemName);
  }, [systemName]);

  // Fetch profile name when user is available
  useEffect(() => {
    if (!authUser) {
      setProfileName(null);
      return;
    }
    
    const fetchProfileName = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", authUser.id)
        .maybeSingle();
      setProfileName(data?.full_name || null);
    };
    
    fetchProfileName();
  }, [authUser]);

  // Load voice settings when auth changes
  useEffect(() => {
    const loadVoiceSettings = async () => {
      if (!authUser) return;
      try {
        const { settings } = await voiceService.getSettings();
        setVoiceSettings(settings);
      } catch (error) {
        console.error('Failed to load voice settings:', error);
      }
    };
    loadVoiceSettings();
  }, [authUser]);

  // Computed account display values
  const isSignedIn = !!session && !!authUser;
  const accountLabel = isSignedIn 
    ? (profileName || authUser?.user_metadata?.full_name || authUser?.email || "User")
    : "Guest";
  const accountDescription = isSignedIn ? "Signed in" : "Not signed in";

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

  const handleCommunicationChange = async (mode: "text" | "voice" | "both") => {
    updateUser({ communicationMode: mode });
    
    // Persist to localStorage
    localStorage.setItem("ozlon_communication_mode", mode);
    toast.success(`Communication mode set to ${mode === "both" ? "text and voice" : mode}`);
  };

  const handleAutoPlayToggle = async (enabled: boolean) => {
    if (!voiceSettings) return;
    setIsLoadingVoice(true);
    try {
      const updated = await voiceService.updateSettings({ auto_play_responses: enabled });
      setVoiceSettings(prev => prev ? { ...prev, ...updated } : null);
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
      console.error('Voice preview failed:', error);
      toast.error("Failed to preview voice. Please try again.");
    } finally {
      setIsPreviewingVoice(false);
    }
  };

  const handleSaveOsName = async () => {
    const trimmedName = tempName.trim();
    if (!trimmedName) {
      toast.error("Please enter a name");
      return;
    }
    
    setOsName(trimmedName);
    localStorage.setItem("ozlon_system_name", trimmedName);
    
    // Also update in database if user is logged in
    if (authUser) {
      await supabase
        .from("profiles")
        .update({ system_name: trimmedName })
        .eq("user_id", authUser.id);
    }
    
    setIsEditingName(false);
    toast.success(`System renamed to ${trimmedName}`);
  };

  const agentIcons: Record<string, typeof Cpu> = {
    memory: Brain,
    orchestration: Cpu,
    communication: MessageSquare,
    personality: Smile,
    banking: Wallet,
    summary: FileText,
  };

  // Show loading state
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
      {/* Header with Back Button */}
      <header className="border-b border-border/50 px-4 py-4 safe-area-top">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Settings</h1>
            <p className="text-xs text-muted-foreground">System configuration</p>
          </div>
        </div>
      </header>

      <div className="px-4">
        {/* Account */}
        <SettingsSection title="Account">
          <SettingsRow
            icon={User}
            label={accountLabel}
            description={accountDescription}
            onClick={() => navigate(isSignedIn ? "/profile" : "/auth")}
          />
        </SettingsSection>

        {/* Voice Mode */}
        <SettingsSection title="Communication Mode">
          <SettingsRow
            icon={Keyboard}
            label="Text only"
            type="toggle"
            value={communicationMode === "text"}
            onChange={() => handleCommunicationChange("text")}
          />
          <SettingsRow
            icon={Mic}
            label="Voice only"
            type="toggle"
            value={communicationMode === "voice"}
            onChange={() => handleCommunicationChange("voice")}
          />
          <SettingsRow
            icon={Type}
            label="Text and voice"
            type="toggle"
            value={communicationMode === "both"}
            onChange={() => handleCommunicationChange("both")}
          />
        </SettingsSection>

        {/* Voice Conversation */}
        <SettingsSection title="Voice Conversation">
          <SettingsRow
            icon={Phone}
            label="Enable Voice Features"
            description={!isAuthenticated ? "Sign in to enable voice conversation" : voiceEnabled ? "Voice output active" : "Turn on to hear AI responses"}
            type="toggle"
            value={voiceEnabled}
            onChange={setVoiceEnabled}
            disabled={!isAuthenticated}
          />
          <SettingsRow
            icon={Volume2}
            label="Voice Preview"
            description="Aria - ElevenLabs voice"
            type="action"
            onClick={handlePreviewVoice}
            actionLabel={isPreviewingVoice ? "Playing..." : "Preview"}
            disabled={isPreviewingVoice}
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
        </SettingsSection>

        {/* Connections */}
        <SettingsSection title="Connections">
          <SettingsRow
            icon={Calendar}
            label="Calendar"
            description={connections.find((c) => c.id === "calendar")?.connected ? "Connected" : "Not connected"}
            type="toggle"
            value={connections.find((c) => c.id === "calendar")?.connected}
            onChange={(val) => updateConnection("calendar", val)}
          />
          <SettingsRow
            icon={Mail}
            label="Email"
            description={connections.find((c) => c.id === "email")?.connected ? "Connected" : "Not connected"}
            type="toggle"
            value={connections.find((c) => c.id === "email")?.connected}
            onChange={(val) => updateConnection("email", val)}
          />
          <SettingsRow
            icon={CreditCard}
            label="Banking"
            description={connections.find((c) => c.id === "banking")?.connected ? "Connected" : "Not connected"}
            type="toggle"
            value={connections.find((c) => c.id === "banking")?.connected}
            onChange={(val) => updateConnection("banking", val)}
          />
        </SettingsSection>

        {/* Maton AI Integrations */}
        <MatonIntegrations />

        {/* Agents */}
        <SettingsSection title="Agents">
          {agents.map((agent) => {
            const Icon = agentIcons[agent.id] || Cpu;
            return (
              <SettingsRow
                key={agent.id}
                icon={Icon}
                label={agent.name}
                description={agent.status === "pending" ? "Coming soon" : agent.enabled ? "Enabled" : "Disabled"}
                type="toggle"
                value={agent.enabled}
                onChange={() => toggleAgent(agent.id)}
                disabled={agent.status === "pending"}
              />
            );
          })}
        </SettingsSection>

        {/* System */}
        <SettingsSection title="System">
          <div className="w-full p-4 rounded-2xl bg-card/60 border border-border/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-muted/60">
                  <Edit3 className="w-5 h-5 text-foreground/70" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-medium text-foreground">Operating System Name</p>
                  <p className="text-xs text-muted-foreground">Personalize your system</p>
                </div>
              </div>
            </div>
            
            {isEditingName ? (
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  placeholder="Enter system name"
                  className={cn(
                    "flex-1 px-4 py-2 rounded-lg border border-border",
                    "bg-background text-foreground",
                    "focus:outline-none focus:ring-2 focus:ring-ring"
                  )}
                  autoFocus
                />
                <button
                  onClick={handleSaveOsName}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditingName(false);
                    setTempName(osName);
                  }}
                  className="px-4 py-2 rounded-lg bg-muted text-muted-foreground font-medium hover:bg-muted/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-lg font-light text-foreground">{osName}</span>
                <button
                  onClick={() => setIsEditingName(true)}
                  className="px-3 py-1.5 text-sm rounded-full bg-muted text-foreground hover:bg-muted/80 transition-colors"
                >
                  Rename
                </button>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* Data Management */}
        <SettingsSection title="Data">
          <SettingsRow
            icon={Trash2}
            label="Clear chat history"
            description="Delete all conversation history"
            type="action"
            onClick={() => setShowClearChatDialog(true)}
            destructive
          />
        </SettingsSection>

        {/* Account Actions */}
        {isSignedIn && (
          <SettingsSection title="Account Actions">
            <SettingsRow
              icon={LogOut}
              label="Sign out"
              description="Sign out of your account"
              type="action"
              onClick={() => setShowSignOutDialog(true)}
              destructive
            />
          </SettingsSection>
        )}
      </div>

      {/* Sign Out Confirmation Dialog */}
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
            <AlertDialogAction onClick={handleLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Chat Confirmation Dialog */}
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
            <AlertDialogAction onClick={handleClearChat} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Settings;
