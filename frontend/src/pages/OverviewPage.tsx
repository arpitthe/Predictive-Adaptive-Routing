import React, { useMemo } from "react";
import {
  Server,
  Network,
  Activity,
  AlertTriangle,
  Cpu,
  Route,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Router, Link, RoutingDecision } from "../types";
import { MetricCard } from "../components/common/MetricCard";
import { NetworkTopologyGraph } from "../components/topology/NetworkTopologyGraph";

interface OverviewPageProps {
  routers: Router[];
  links: Link[];
  recentDecisions: RoutingDecision[];
  onSelectLink: (link: Link) => void;
  onNavigateTab: (tab: any) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  routers,
  links,
  recentDecisions,
  onSelectLink,
  onNavigateTab,
}) => {
  // Aggregate Metrics
  const avgUtilization = useMemo(() => {
    if (links.length === 0) return 0;
    const sum = links.reduce((acc, l) => acc + l.utilizationPct, 0);
    return Number((sum / links.length).toFixed(1));
  }, [links]);

  const congestedLinks = useMemo(() => {
    return links.filter((l) => l.utilizationPct >= 50);
  }, [links]);

  const activePath = useMemo(() => {
    return recentDecisions.length > 0 ? recentDecisions[0].linkPath : [];
  }, [recentDecisions]);

  // Chart Data: Utilization per link
  const chartData = useMemo(() => {
    return links.map((l) => ({
      name: l.linkId,
      utilization: Number(l.utilizationPct.toFixed(1)),
      isCongested: l.utilizationPct >= 50,
    }));
  }, [links]);

  return (
    <div className="space-y-6 p-6">
      {/* 1. KPI Metric Cards Row */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Core Routers"
          value={routers.length}
          subtitle="All nodes active in topology"
          icon={Server}
          badge="HEALTHY"
          badgeColor="emerald"
        />
        <MetricCard
          title="Monitored Links"
          value={links.length}
          subtitle="Full bidirectional mesh"
          icon={Network}
          badge="100% ONLINE"
          badgeColor="cyan"
        />
        <MetricCard
          title="Average Utilization"
          value={`${avgUtilization}%`}
          subtitle="Global backbone load"
          icon={Activity}
          badge={avgUtilization >= 50 ? "ELEVATED" : "OPTIMAL"}
          badgeColor={avgUtilization >= 50 ? "rose" : "emerald"}
          glow={avgUtilization >= 50}
        />
        <MetricCard
          title="Congestion Alerts"
          value={congestedLinks.length}
          subtitle="Links exceeding 50% threshold"
          icon={AlertTriangle}
          badge={congestedLinks.length > 0 ? "ATTENTION" : "CLEAR"}
          badgeColor={congestedLinks.length > 0 ? "rose" : "emerald"}
          glow={congestedLinks.length > 0}
        />
      </div>

      {/* 2. Middle Row: Interactive Topology + Link Load Distribution */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Topology Preview (2 cols) */}
        <div className="xl:col-span-2">
          <NetworkTopologyGraph
            routers={routers}
            links={links}
            activeLinkPath={activePath}
            onSelectLink={onSelectLink}
          />
        </div>

        {/* Link Load Distribution Chart (1 col) */}
        <div className="flex flex-col rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
          <div className="flex items-center justify-between border-b border-noc-border pb-3">
            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                Link Utilization Profile
              </h3>
              <p className="text-xs text-slate-400">
                50% Threshold triggers predictive penalty
              </p>
            </div>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-cyber-cyan">
              Live Scale
            </span>
          </div>

          <div className="mt-4 h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 25 }}
              >
                <XAxis
                  dataKey="name"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  angle={-35}
                  textAnchor="end"
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0d1424",
                    borderColor: "#1a263d",
                    borderRadius: "8px",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                  formatter={(value: any) => [`${value}%`, "Utilization"]}
                />
                <ReferenceLine
                  y={50}
                  stroke="#f43f5e"
                  strokeDasharray="4 4"
                  label={{
                    value: "50% Congestion Gate",
                    fill: "#f43f5e",
                    fontSize: 10,
                    position: "top",
                  }}
                />
                <Bar dataKey="utilization" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.utilization >= 50
                          ? "#f43f5e"
                          : entry.utilization >= 40
                          ? "#f59e0b"
                          : "#10b981"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-auto border-t border-noc-border pt-3 text-xs text-slate-400">
            <div className="flex justify-between">
              <span>Congested Links:</span>
              <span className="font-mono font-bold text-rose-400">
                {congestedLinks.map((l) => l.linkId).join(", ") || "None (Optimal)"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Row: Link Snapshot Table & Recent Decisions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Link Snapshot Table */}
        <div className="rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
          <div className="flex items-center justify-between border-b border-noc-border pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyber-cyan" />
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                Network Links Snapshot
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab("monitoring")}
              className="text-xs text-cyber-cyan hover:underline"
            >
              View Full Monitoring →
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-mono">
                <tr>
                  <th className="py-2.5">Link ID</th>
                  <th className="py-2.5">Bandwidth</th>
                  <th className="py-2.5">Latency</th>
                  <th className="py-2.5">Utilization</th>
                  <th className="py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {links.map((link) => {
                  const isCongested = link.utilizationPct >= 50;
                  return (
                    <tr
                      key={link.linkId}
                      className="cursor-pointer hover:bg-slate-800/40"
                      onClick={() => onSelectLink(link)}
                    >
                      <td className="py-2.5 font-bold text-white">
                        {link.linkId}
                      </td>
                      <td className="py-2.5 text-slate-300">
                        {link.bandwidthMbps} Mbps
                      </td>
                      <td className="py-2.5 text-slate-300">
                        {link.latencyMs} ms
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`font-bold ${
                            isCongested ? "text-rose-400" : "text-emerald-400"
                          }`}
                        >
                          {link.utilizationPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            isCongested
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          {isCongested ? "CONGESTED" : "HEALTHY"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Routing Decisions Audit */}
        <div className="rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
          <div className="flex items-center justify-between border-b border-noc-border pb-3">
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 text-cyber-cyan" />
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                Recent Predictive Routing Decisions
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab("routing")}
              className="text-xs text-cyber-cyan hover:underline"
            >
              Open Route Engine →
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {recentDecisions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-slate-400">
                <Route className="h-8 w-8 text-slate-600 mb-2" />
                <p>No routing decisions calculated yet.</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Navigate to Adaptive Routing or click "Quick Compute" above.
                </p>
              </div>
            ) : (
              recentDecisions.slice(0, 4).map((dec) => (
                <div
                  key={dec._id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-cyber-cyan">
                      {dec.sourceRouter} → {dec.destinationRouter}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      Cost: {dec.totalCost.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 font-mono text-xs text-slate-200">
                    <span className="text-slate-400">Path:</span>
                    {dec.routerPath.join(" → ")}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                    <span>Policy: {dec.routingPolicy}</span>
                    <span>{new Date(dec.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

