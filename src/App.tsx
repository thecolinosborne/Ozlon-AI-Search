import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ColdStart from "./pages/onboarding/ColdStart";
import NameIntake from "./pages/onboarding/NameIntake";
import OrbNaming from "./pages/onboarding/OrbNaming";
import CommunicationMode from "./pages/onboarding/CommunicationMode";
import OrbOrientation from "./pages/onboarding/OrbOrientation";
import DailyStructure from "./pages/onboarding/DailyStructure";
import PriorityDomains from "./pages/onboarding/PriorityDomains";
import ExistingSystems from "./pages/onboarding/ExistingSystems";
import InsightStyle from "./pages/onboarding/InsightStyle";
import OptionalConnections from "./pages/onboarding/Connections";
import FirstAnalysis from "./pages/onboarding/FirstAnalysis";
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
          <Route path="/onboarding/orb-naming" element={<OrbNaming />} />
          <Route path="/onboarding/communication-mode" element={<CommunicationMode />} />
          <Route path="/onboarding/orb-orientation" element={<OrbOrientation />} />
          <Route path="/onboarding/daily-structure" element={<DailyStructure />} />
          <Route path="/onboarding/priority-domains" element={<PriorityDomains />} />
          <Route path="/onboarding/existing-systems" element={<ExistingSystems />} />
          <Route path="/onboarding/insight-style" element={<InsightStyle />} />
          <Route path="/onboarding/optional-connections" element={<OptionalConnections />} />
          <Route path="/onboarding/first-analysis" element={<FirstAnalysis />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
