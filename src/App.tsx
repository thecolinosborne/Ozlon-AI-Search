import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { AuthProvider } from "@/contexts/AuthContext";


// Pages
import Index from "@/pages/Index";
import Settings from "@/pages/Settings";
import PersonalitySettings from "@/pages/PersonalitySettings";
import ModelRouting from "@/pages/ModelRouting";
import Developer from "@/pages/Developer";
import AuthPage from "@/pages/AuthPage";
import Profile from "@/pages/Profile";
import Billing from "@/pages/Billing";
import Onboarding from "@/pages/onboarding";
import Integrations from "@/pages/Integrations";
import Wisdom from "@/pages/Wisdom";

import GoHighLevelDetail from "@/pages/integrations/GoHighLevelDetail";
import DescriptDetail from "@/pages/integrations/DescriptDetail";
import HiggsFieldDetail from "@/pages/integrations/HiggsFieldDetail";
import ClickUpDetail from "@/pages/integrations/ClickUpDetail";
import YouTubeDetail from "@/pages/integrations/YouTubeDetail";
import GmailDetail from "@/pages/integrations/GmailDetail";
import GoogleDriveDetail from "@/pages/integrations/GoogleDriveDetail";
import GoogleCalendarDetail from "@/pages/integrations/GoogleCalendarDetail";
import GoogleSheetsDetail from "@/pages/integrations/GoogleSheetsDetail";
import GoogleDocsDetail from "@/pages/integrations/GoogleDocsDetail";
import GoogleSlidesDetail from "@/pages/integrations/GoogleSlidesDetail";
import GoogleAnalyticsDetail from "@/pages/integrations/GoogleAnalyticsDetail";
import GoogleSearchConsoleDetail from "@/pages/integrations/GoogleSearchConsoleDetail";
import GoogleTagManagerDetail from "@/pages/integrations/GoogleTagManagerDetail";
import Events from "@/pages/Events";
import Finance from "@/pages/Finance";
import PlaidOAuthReturn from "@/pages/PlaidOAuthReturn";
import { Navigate } from "react-router-dom";

import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const OfflineDetector = () => {
  const { setOffline } = useAppStore();
  useEffect(() => {
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setOffline]);
  return null;
};

const AppRoutes = () => {
  return (
    <>
      <OfflineDetector />
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/personality" element={<PersonalitySettings />} />
        <Route path="/settings/routing" element={<Navigate to="/settings/brain" replace />} />
        <Route path="/settings/brain" element={<ModelRouting />} />
        <Route path="/integrations/ai-processor" element={<Navigate to="/settings/brain" replace />} />
        <Route path="/developer" element={<Developer />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/wisdom" element={<Wisdom />} />
        
        <Route path="/integrations/gohighlevel" element={<GoHighLevelDetail />} />
        <Route path="/integrations/descript" element={<DescriptDetail />} />
        <Route path="/integrations/higgsfield" element={<HiggsFieldDetail />} />
        <Route path="/integrations/clickup" element={<ClickUpDetail />} />
        <Route path="/integrations/youtube" element={<YouTubeDetail />} />
        <Route path="/integrations/gmail" element={<GmailDetail />} />
        <Route path="/integrations/google-drive" element={<GoogleDriveDetail />} />
        <Route path="/integrations/google-calendar" element={<GoogleCalendarDetail />} />
        <Route path="/integrations/google-sheets" element={<GoogleSheetsDetail />} />
        <Route path="/integrations/google-docs" element={<GoogleDocsDetail />} />
        <Route path="/integrations/google-slides" element={<GoogleSlidesDetail />} />
        <Route path="/integrations/google-analytics" element={<GoogleAnalyticsDetail />} />
        <Route path="/integrations/google-search-console" element={<GoogleSearchConsoleDetail />} />
        <Route path="/integrations/google-tag-manager" element={<GoogleTagManagerDetail />} />
        <Route path="/events" element={<Events />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/finance/oauth-return" element={<PlaidOAuthReturn />} />
        <Route path="/" element={<Index />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
