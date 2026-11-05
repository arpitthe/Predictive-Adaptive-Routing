import React, { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  Radio,
  RefreshCw,
  Server,
  Zap,
} from "lucide-react";
import { SystemHealth } from "../../types";

interface HeaderProps {
  health: SystemHealth | null;
  onRefresh: () => void;
  isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  onRefresh,
  isLoading,
}) => {
  const [timeStr, setTimeStr] = useState<string>("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        }) +
          " | " +
          now.toLocaleTimeString("en-US", { hour12: false }) +
          " UTC"
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const isHealthy = health?.status === "healthy";
  const storageMode = health?.storageMode || "memory";
  const isChronosReady = health?.mlService?.modelLoaded ?? false;
  const isGns3Online = health?.gns3?.connected ?? false;

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-noc-border bg-noc-canvas/95 px-6 backdrop-blur">
      {/* Left: Branding */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan shadow-[0_0_15px_-3px_rgba(0,240,255,0.4)]">
          <Zap className="h-5 w-5 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-white font-mono">
              PREDICTIVE ADAPTIVE ROUTING
            </h1>
            <span className="rounded border border-cyber-cyan/30 bg-cyber-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyber-cyan">
              v2.4 Core
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Autonomous Traffic Steering & Congestion Forecasting Console
          </p>
        </div>
      </div>

      {/* Right: Operational Status Badges & Time */}
      <div className="flex items-center gap-4">
        {/* Data Source Badge */}
        <div className="hidden items-center gap-1.5 rounded-lg border border-noc-border bg-noc-card px-3 py-1.5 text-xs lg:flex">
          <span className="text-slate-400">DATA SOURCE:</span>
          <span className="font-mono font-semibold text-cyber-cyan uppercase">
            {storageMode === "memory" ? "DEMO REPLAY (IN-MEMORY)" : "LIVE MONGODB"}
          </span>
        </div>

        {/* Chronos-2 Status */}
        <div className="flex items-center gap-2 rounded-lg border border-noc-border bg-noc-card px-3 py-1.5 text-xs">
          <Cpu className="h-3.5 w-3.5 text-cyber-cyan" />
          <span className="text-slate-400">CHRONOS-2:</span>
          <span
            className={`font-mono font-bold ${
              isChronosReady ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {isChronosReady ? "ZERO-SHOT ACTIVE" : "STANDBY"}
          </span>
        </div>

        {/* GNS3 Status */}
        <div className="hidden items-center gap-2 rounded-lg border border-noc-border bg-noc-card px-3 py-1.5 text-xs sm:flex">
          <Radio className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-400">GNS3:</span>
          <span
            className={`font-mono font-bold ${
              isGns3Online ? "text-emerald-400" : "text-slate-400"
            }`}
          >
            {isGns3Online ? "ONLINE" : "STANDBY"}
          </span>
        </div>

        {/* System Health Indicator */}
        <div className="flex items-center gap-2 rounded-lg border border-noc-border bg-noc-card px-3 py-1.5 text-xs">
          <div
            className={`h-2 w-2 rounded-full ${
              isHealthy
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                : "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]"
            }`}
          />
          <span className="font-mono font-semibold text-slate-200">
            {isHealthy ? "OPERATIONAL" : "DEGRADED"}
          </span>
        </div>

        {/* Live Clock */}
        <div className="hidden font-mono text-xs text-slate-400 xl:block">
          {timeStr}
        </div>

        {/* Refresh Action */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh All System Data"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-noc-border bg-noc-card text-slate-300 transition-colors hover:border-cyber-cyan/50 hover:bg-noc-card-hover hover:text-cyber-cyan disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isLoading ? "animate-spin text-cyber-cyan" : ""}`}
          />
        </button>
      </div>
    </header>
  );
};

