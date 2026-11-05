import React, { useState } from "react";
import {
  Server,
  Network,
  Activity,
  Zap,
  Sliders,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { Router, Link } from "../types";
import { NetworkTopologyGraph } from "../components/topology/NetworkTopologyGraph";

interface TopologyPageProps {
  routers: Router[];
  links: Link[];
  selectedLink: Link | null;
  onSelectLink: (link: Link) => void;
}

export const TopologyPage: React.FC<TopologyPageProps> = ({
  routers,
  links,
  selectedLink,
  onSelectLink,
}) => {
  const [selectedRouter, setSelectedRouter] = useState<Router | null>(null);

  const handleRouterClick = (router: Router) => {
    setSelectedRouter(router);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col gap-6 p-6 lg:flex-row overflow-hidden">
      {/* Left / Center: Interactive Topology Canvas */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <NetworkTopologyGraph
          routers={routers}
          links={links}
          onSelectLink={onSelectLink}
          onSelectRouter={handleRouterClick}
          selectedLinkId={selectedLink?.linkId}
          selectedRouterId={selectedRouter?.routerId}
        />
      </div>

      {/* Right: Inspector Sidebar */}
      <div className="flex w-full flex-col gap-5 lg:w-96 overflow-y-auto">
        {/* Selected Item Detail Card */}
        {selectedLink ? (
          <div className="rounded-xl border border-cyber-cyan/40 bg-noc-card p-5 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between border-b border-noc-border pb-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-cyber-cyan" />
                <h3 className="font-mono text-sm font-bold text-white">
                  Link: {selectedLink.linkId}
                </h3>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  selectedLink.utilizationPct >= 50
                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                }`}
              >
                {selectedLink.utilizationPct >= 50 ? "CONGESTED" : "HEALTHY"}
              </span>
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Current Utilization:</span>
                <span className="font-mono font-bold text-white">
                  {selectedLink.utilizationPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Bandwidth / Capacity:</span>
                <span className="font-mono text-slate-200">
                  {selectedLink.bandwidthMbps} Mbps
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>One-Way Delay:</span>
                <span className="font-mono text-slate-200">
                  {selectedLink.latencyMs} ms
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>ML Link Index:</span>
                <span className="font-mono text-cyber-cyan">
                  {selectedLink.mlLinkIndex ?? "Auto"}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Status:</span>
                <span className="font-mono text-emerald-400 uppercase">
                  {selectedLink.status}
                </span>
              </div>
            </div>

            <div className="mt-4 rounded border border-slate-800 bg-slate-900/60 p-2.5 text-[11px] text-slate-400">
              {selectedLink.utilizationPct >= 50 ? (
                <p className="text-rose-400">
                  ⚠️ Utilization exceeds 50%. The non-linear exponential penalty function is active for this link in Dijkstra route calculations.
                </p>
              ) : (
                <p className="text-emerald-400">
                  ✓ Link operates in linear cost regime. Edge weight equals raw utilization.
                </p>
              )}
            </div>
          </div>
        ) : selectedRouter ? (
          <div className="rounded-xl border border-cyber-cyan/40 bg-noc-card p-5 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between border-b border-noc-border pb-3">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-cyber-cyan" />
                <h3 className="font-mono text-sm font-bold text-white">
                  Router: {selectedRouter.routerId}
                </h3>
              </div>
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                ACTIVE
              </span>
            </div>

            <div className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Name:</span>
                <span className="font-semibold text-white">
                  {selectedRouter.name}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>IP Address:</span>
                <span className="font-mono text-cyber-cyan">
                  {selectedRouter.ipAddress}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Location:</span>
                <span className="text-slate-300">
                  {selectedRouter.location || "Core Backbone"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-noc-border bg-noc-card/60 p-4 text-center text-xs text-slate-400">
            Click any router node or link line to inspect live metrics.
          </div>
        )}

        {/* Routers Inventory Card */}
        <div className="flex-1 rounded-xl border border-noc-border bg-noc-card/90 p-4 backdrop-blur">
          <div className="flex items-center justify-between border-b border-noc-border pb-2.5">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
              Router Inventory ({routers.length})
            </h4>
            <span className="text-[10px] text-slate-400">Core Nodes</span>
          </div>

          <div className="mt-3 space-y-2 overflow-y-auto max-h-48 pr-1">
            {routers.map((router) => (
              <div
                key={router.routerId}
                onClick={() => setSelectedRouter(router)}
                className={`flex cursor-pointer items-center justify-between rounded-lg border p-2 text-xs transition-colors ${
                  selectedRouter?.routerId === router.routerId
                    ? "border-cyber-cyan bg-cyber-cyan/10"
                    : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="font-mono font-bold text-white">
                    {router.routerId}
                  </span>
                  <span className="text-slate-400 text-[11px] truncate max-w-[120px]">
                    {router.name}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">
                  {router.ipAddress}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

