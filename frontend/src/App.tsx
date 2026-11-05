import React, { useState, useEffect, useCallback } from "react";
import { Header } from "./components/layout/Header";
import { Sidebar, NavTab } from "./components/layout/Sidebar";
import { DemoControlBar } from "./components/common/DemoControlBar";
import { OverviewPage } from "./pages/OverviewPage";
import { TopologyPage } from "./pages/TopologyPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { PredictionsPage } from "./pages/PredictionsPage";
import { RoutingPage } from "./pages/RoutingPage";
import { ExperimentsPage } from "./pages/ExperimentsPage";
import { HealthPage } from "./pages/HealthPage";
import {
  fetchTopology,
  fetchRoutingDecisions,
  fetchSystemHealth,
  fetchGns3Status,
} from "./services/apiClient";
import { Router, Link, RoutingDecision, SystemHealth, Gns3Status } from "./types";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [routers, setRouters] = useState<Router[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [recentDecisions, setRecentDecisions] = useState<RoutingDecision[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [gns3Status, setGns3Status] = useState<Gns3Status | null>(null);
  const [selectedLink, setSelectedLink] = useState<Link | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load all core system data from the Node.js backend
  const loadSystemData = useCallback(async () => {
    try {
      const [topData, decData, healthData, gns3Data] = await Promise.allSettled([
        fetchTopology(),
        fetchRoutingDecisions(10),
        fetchSystemHealth(),
        fetchGns3Status(),
      ]);

      if (topData.status === "fulfilled") {
        setRouters(topData.value.routers || []);
        setLinks(topData.value.links || []);
      }

      if (decData.status === "fulfilled") {
        setRecentDecisions(decData.value || []);
      }

      if (healthData.status === "fulfilled") {
        setHealth(healthData.value);
      }

      if (gns3Data.status === "fulfilled") {
        setGns3Status(gns3Data.value);
      }
    } catch (err) {
      console.error("Error refreshing system data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSystemData();

    // Configurable polling interval (default 10s)
    const pollInterval = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 10000;
    const timer = setInterval(loadSystemData, pollInterval);
    return () => clearInterval(timer);
  }, [loadSystemData]);

  const handleSelectLink = (link: Link) => {
    setSelectedLink(link);
  };

  const handleDecisionCreated = (decision: RoutingDecision) => {
    setRecentDecisions((prev) => [decision, ...prev]);
  };

  return (
    <div className="flex min-h-screen flex-col bg-noc-canvas text-slate-100">
      {/* 1. Top Global Navigation Header */}
      <Header
        health={health}
        onRefresh={loadSystemData}
        isLoading={isLoading}
      />

      {/* 2. Demonstration Quick Control Bar */}
      <DemoControlBar onDataChanged={loadSystemData} />

      {/* 3. Main Body: Sidebar + Active Page Area */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          storageMode={health?.storageMode || "memory"}
        />

        <main className="flex-1 overflow-y-auto">
          {activeTab === "overview" && (
            <OverviewPage
              routers={routers}
              links={links}
              recentDecisions={recentDecisions}
              onSelectLink={handleSelectLink}
              onNavigateTab={setActiveTab}
            />
          )}

          {activeTab === "topology" && (
            <TopologyPage
              routers={routers}
              links={links}
              selectedLink={selectedLink}
              onSelectLink={handleSelectLink}
            />
          )}

          {activeTab === "monitoring" && (
            <MonitoringPage
              links={links}
              selectedLink={selectedLink}
              onSelectLink={handleSelectLink}
            />
          )}

          {activeTab === "predictions" && (
            <PredictionsPage
              links={links}
              selectedLink={selectedLink}
              onSelectLink={handleSelectLink}
            />
          )}

          {activeTab === "routing" && (
            <RoutingPage
              routers={routers}
              links={links}
              gns3Status={gns3Status}
              onDecisionCreated={handleDecisionCreated}
            />
          )}

          {activeTab === "experiments" && <ExperimentsPage />}

          {activeTab === "health" && (
            <HealthPage
              health={health}
              onRefresh={loadSystemData}
              isLoading={isLoading}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;

