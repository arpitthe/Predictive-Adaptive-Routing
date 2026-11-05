import React from "react";
import {
  ShieldCheck,
  Server,
  Cpu,
  HardDrive,
  Radio,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Code2,
} from "lucide-react";
import { SystemHealth } from "../types";

interface HealthPageProps {
  health: SystemHealth | null;
  onRefresh: () => void;
  isLoading: boolean;
}

export const HealthPage: React.FC<HealthPageProps> = ({
  health,
  onRefresh,
  isLoading,
}) => {
  const isHealthy = health?.status === "healthy";
  const storageMode = health?.storageMode || "memory";
  const isChronosReady = health?.mlService?.modelLoaded ?? false;
  const isGns3Online = health?.gns3?.connected ?? false;

  const services = [
    {
      name: "React Frontend Console",
      port: "3000",
      status: "OPERATIONAL",
      isOk: true,
      desc: "Vite + TypeScript + Tailwind NOC User Interface",
      icon: Server,
    },
    {
      name: "Node.js Orchestration Backend",
      port: "5001",
      status: health?.backend ? "ONLINE" : "DISCONNECTED",
      isOk: Boolean(health?.backend),
      desc: "Express 5 API Orchestrator & Telemetry Ingestion Gateway",
      icon: Server,
    },
    {
      name: "Python Chronos-2 Prediction Layer",
      port: "8000",
      status: isChronosReady ? "MODEL READY" : "STANDBY / MISSING",
      isOk: isChronosReady,
      desc: `amazon/chronos-2 foundation time-series forecaster (${health?.mlService?.device || "cpu"})`,
      icon: Cpu,
    },
    {
      name: "Storage Subsystem",
      port: storageMode === "memory" ? "In-Process" : "27017",
      status: `${storageMode.toUpperCase()} MODE ACTIVE`,
      isOk: true,
      desc:
        storageMode === "memory"
          ? "In-memory query engine (MongoDB not required for faculty demonstration)"
          : "MongoDB Replica / Standalone connection active",
      icon: HardDrive,
    },
    {
      name: "Dijkstra Routing Engine",
      port: "Internal",
      status: "OPERATIONAL",
      isOk: true,
      desc: "Non-linear predictive utilization cost path calculator",
      icon: ShieldCheck,
    },
    {
      name: "GNS3 Network Emulation Server",
      port: "3080",
      status: isGns3Online ? "ONLINE" : "STANDBY",
      isOk: isGns3Online,
      desc: health?.gns3?.note || "Accepts live telemetry stream via POST /api/telemetry",
      icon: Radio,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Top Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-cyber-cyan" />
            <h2 className="text-base font-bold text-white uppercase tracking-wider font-mono">
              System Health & Infrastructure Diagnostics
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time status of all architectural subsystems, services, and hardware adapters.
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-lg border border-noc-border bg-noc-card px-4 py-2 text-xs font-mono font-semibold text-slate-200 transition-colors hover:border-cyber-cyan hover:text-cyber-cyan disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin text-cyber-cyan" : ""}`} />
          <span>{isLoading ? "Probing Services..." : "Re-Probe All Services"}</span>
        </button>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {services.map((svc) => {
          const Icon = svc.icon;
          return (
            <div
              key={svc.name}
              className={`rounded-xl border p-5 backdrop-blur transition-all ${
                svc.isOk
                  ? "border-noc-border bg-noc-card/90"
                  : "border-amber-500/30 bg-noc-card/90"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-cyber-cyan">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      {svc.name}
                    </h3>
                    <span className="font-mono text-[10px] text-slate-400">
                      Port: {svc.port}
                    </span>
                  </div>
                </div>

                <span
                  className={`rounded border px-2 py-0.5 text-[9px] font-bold font-mono ${
                    svc.isOk
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  }`}
                >
                  {svc.status}
                </span>
              </div>

              <p className="mt-3 text-xs text-slate-400 border-t border-slate-800/80 pt-3">
                {svc.desc}
              </p>
            </div>
          );
        })}
      </div>

      {/* Raw Health JSON Viewer */}
      {health && (
        <div className="rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
          <div className="flex items-center justify-between border-b border-noc-border pb-3">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-cyber-cyan" />
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Raw Health Response Payload (GET /api/health)
              </h3>
            </div>
            <span className="font-mono text-[10px] text-slate-400">
              {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          </div>

          <pre className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-slate-300">
            {JSON.stringify(health, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

