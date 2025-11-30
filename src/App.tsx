import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ColdStart from "./pages/onboarding/ColdStart";
import NameIntake from "./pages/onboarding/NameIntake";
import LocationConfirm from "./pages/onboarding/LocationConfirm";
import MainNeed from "./pages/onboarding/MainNeed";
import Connections from "./pages/onboarding/Connections";
import Insight from "./pages/onboarding/Insight";
import FocusArea from "./pages/onboarding/FocusArea";
import Final from "./pages/onboarding/Final";
import Chat from "./pages/Chat";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ColdStart />} />
          <Route path="/onboarding/name" element={<NameIntake />} />
          <Route path="/onboarding/location" element={<LocationConfirm />} />
          <Route path="/onboarding/main-need" element={<MainNeed />} />
          <Route path="/onboarding/focus" element={<FocusArea />} />
          <Route path="/onboarding/connections" element={<Connections />} />
          <Route path="/onboarding/insight" element={<Insight />} />
          <Route path="/onboarding/final" element={<Final />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
