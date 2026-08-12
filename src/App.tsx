import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DataProvider } from "@/hooks/useData";
import AppLayout from "@/components/layout/AppLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Campaigns from "./pages/Campaigns";
import Targets from "./pages/Targets";
import TeamPerformance from "./pages/TeamPerformance";
import Agents from "./pages/Agents";
import SettingsPage from "./pages/Settings";
import AppointmentsCalendar from "./pages/AppointmentsCalendar";
import NotFound from "./pages/NotFound";


const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <DataProvider>
            <AppLayout>
              {/**
                * 🔴 TWO FINISHED PAGES WERE IMPORTED BY NOTHING AND ROUTED NOWHERE.
                * `pages/Accounts.tsx` and `pages/Campaigns.tsx` are complete, actively
                * maintained surfaces — `accountRegistry.ts` names both of them as screens
                * whose identity resolution it fixes, `SourceStatusBanner` keeps a
                * per-route source map, and `Campaigns.tsx` carries a comment claiming it
                * killed a native `<select>` because "the complaint was still live on a
                * TOP-LEVEL PAGE". It was not a page. Dead code that claims to have shipped
                * a fix is worse than dead code: it makes the fix look done.
                *
                * Restoring the two routes is strictly additive — no existing path moves —
                * and it is what makes the per-route source map and the nav agree with the
                * router. `/agents` was already routed and simply missing from the nav;
                * see AppSidebar.
                */}
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/campaigns" element={<Campaigns />} />
                <Route path="/targets" element={<Targets />} />
                <Route path="/team" element={<TeamPerformance />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/calendar" element={<AppointmentsCalendar />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </DataProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
