import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { BottomNav } from "@/components/navigation/BottomNav";
import { useAppStore } from "@/stores/useAppStore";

// Pages
import Home from "@/pages/Home";
import Chat from "@/pages/Chat";
import Settings from "@/pages/Settings";
import Auth from "@/pages/Auth";
import Onboarding from "@/pages/onboarding";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const showNav = ["/home", "/chat", "/settings"].includes(location.pathname);
  return (
    <>
      {children}
      {showNav && <BottomNav />}
    </>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAppStore();
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  if (!user?.onboardingComplete) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
};

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
        <AppLayout>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
