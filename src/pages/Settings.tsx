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
} from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { useAppStore } from "@/stores/useAppStore";
import { supabase } from "@/integrations/supabase/client";
import { localDb } from "@/services/localDb";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

const STORAGE_KEY = "ozlon_system_name";

const Settings = () => {
  const navigate = useNavigate();
  const { user, updateUser, connections, updateConnection, agents, toggleAgent, reset, clearMessages: clearStoreMessages } = useAppStore();
  
  // OS Name state
  const [osName, setOsName] = useState(() => localStorage.getItem(STORAGE_KEY) || "Ozlon");
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(osName);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [showClearChatDialog, setShowClearChatDialog] = useState(false);

  const communicationMode = user?.communicationMode || "both";

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      reset();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("ozlon_onboarded");
      toast.success("Signed out successfully");
      navigate("/");
    } catch (error: any) {
      console.error("Sign out error:", error);
      toast.error(error.message || "Failed to sign out");
    }
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
  };

  const handleSaveOsName = async () => {
    const trimmedName = tempName.trim();
    if (!trimmedName) {
      toast.error("Please enter a name");
      return;
    }
    
    setOsName(trimmedName);
    localStorage.setItem(STORAGE_KEY, trimmedName);
    
    // Also update in database if user is logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase
        .from("profiles")
        .update({ system_name: trimmedName })
        .eq("user_id", session.user.id);
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
            label={user?.name || "Guest"}
            description={user?.email || "Not signed in"}
            onClick={() => navigate("/auth")}
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
