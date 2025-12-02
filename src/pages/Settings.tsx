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
} from "lucide-react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { useAppStore } from "@/stores/useAppStore";

const Settings = () => {
  const navigate = useNavigate();
  const { user, updateUser, connections, updateConnection, agents, toggleAgent, reset } = useAppStore();

  const communicationMode = user?.communicationMode || "both";

  const handleLogout = () => {
    // TODO: Wire to Supabase logout - onLogout callback
    reset();
    navigate("/auth");
  };

  const handleCommunicationChange = (mode: "text" | "voice" | "both") => {
    updateUser({ communicationMode: mode });
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
      {/* Header */}
      <header className="px-6 pt-12 pb-6 safe-area-top">
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">System configuration</p>
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

        {/* Danger Zone */}
        <SettingsSection title="Account Actions">
          <SettingsRow
            icon={LogOut}
            label="Sign out"
            type="action"
            onClick={handleLogout}
            destructive
          />
        </SettingsSection>
      </div>
    </div>
  );
};

export default Settings;
