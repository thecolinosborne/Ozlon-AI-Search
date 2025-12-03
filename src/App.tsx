import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";

// Pages
import Index from "@/pages/Index";
import Settings from "@/pages/Settings";
import Developer from "@/pages/Developer";
import AuthPage from "@/pages/AuthPage";
import Profile from "@/pages/Profile";
import Billing from "@/pages/Billing";
import VoiceSetup from "@/pages/onboarding/VoiceSetup";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <OfflineDetector />
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/developer" element={<Developer />} />
          <Route path="/voice-setup" element={<VoiceSetup />} />
          <Route path="/" element={<Index />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
