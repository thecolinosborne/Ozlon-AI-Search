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
import Developer from "@/pages/Developer";
import AuthPage from "@/pages/AuthPage";
import Profile from "@/pages/Profile";
import Billing from "@/pages/Billing";
import Onboarding from "@/pages/onboarding";
import Integrations from "@/pages/Integrations";
import MatonDetail from "@/pages/integrations/MatonDetail";
import GoHighLevelDetail from "@/pages/integrations/GoHighLevelDetail";
import DescriptDetail from "@/pages/integrations/DescriptDetail";
import HiggsFieldDetail from "@/pages/integrations/HiggsFieldDetail";
import AIProcessorDetail from "@/pages/integrations/AIProcessorDetail";

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
    <AuthProvider>
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
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/integrations/maton" element={<MatonDetail />} />
            <Route path="/integrations/gohighlevel" element={<GoHighLevelDetail />} />
            <Route path="/integrations/descript" element={<DescriptDetail />} />
            <Route path="/integrations/higgsfield" element={<HiggsFieldDetail />} />
            <Route path="/integrations/ai-processor" element={<AIProcessorDetail />} />
            
            <Route path="/" element={<Index />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
