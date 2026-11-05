import React, { useState, useEffect } from "react";
import {
  Activity,
  Search,
  Filter,
  TrendingUp,
  Clock,
  Layers,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Link, TelemetryObservation } from "../types";
import { fetchTelemetryForLink } from "../services/apiClient";

interface MonitoringPageProps {
  links: Link[];
  selectedLink: Link | null;
  onSelectLink: (link: Link) => void;
}

export const MonitoringPage: React.FC<MonitoringPageProps> = ({
  links,
  selectedLink,
  onSelectLink,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRisk, setFilterRisk] = useState<"all" | "congested" | "healthy">("all");
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryObservation[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const activeLink = selectedLink || links[0] || null;

  useEffect(() => {
    if (activeLink) {
      loadHistory(activeLink.linkId);
    }
  }, [activeLink?.linkId]);

  const loadHistory = async (linkId: string) => {
    setIsLoadingHistory(true);
    try {
      const res = await fetchTelemetryForLink(linkId, 50);
      setTelemetryHistory(res.data || []);
    } catch (err) {
      console.error("Failed to load telemetry history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const filteredLinks = links.filter((l) => {
    const matchesSearch = l.linkId.toLowerCase().includes(searchTerm.toLowerCase());
    if (filterRisk === "congested") return matchesSearch && l.utilizationPct >= 50;
    if (filterRisk === "healthy") return matchesSearch && l.utilizationPct < 50;
    return matchesSearch;
  });

  const chartData = telemetryHistory.map((item) => ({
    time: new Date(item.measuredAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    utilization: Number(item.utilizationPct.toFixed(1)),
    throughput: item.throughputMbps ?? 0,
    source: item.source,
  }));

  return (
    <div className="space-y-6 p-6">
      {/* Top Banner / Explainer */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-bold text-white uppercase tracking-wider font-mono">
            Traffic Monitoring & Telemetry Engine
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time link utilization telemetry sampled at 5-minute intervals for Chronos-2 time-series forecasting.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono font-semibold text-emerald-400">
            Cadence: 300s (±60s)
          </span>
          <span className="rounded border border-cyber-cyan/30 bg-cyber-cyan/10 px-2.5 py-1 font-mono font-semibold text-cyber-cyan">
            Lag Window: ≥6 Obs
          </span>
        </div>
      </div>

      {/* Main Grid: Left Table, Right Chart */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Link Telemetry Table (5 cols) */}
        <div className="xl:col-span-5 flex flex-col rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
          {/* Search & Filters */}
          <div className="flex items-center justify-between gap-3 border-b border-noc-border pb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search link ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-noc-border bg-slate-900/60 py-1.5 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyber-cyan focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => setFilterRisk("all")}
                className={`rounded px-2 py-1 ${
                  filterRisk === "all"
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterRisk("congested")}
                className={`rounded px-2 py-1 ${
                  filterRisk === "congested"
                    ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                &ge;50%
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-400 font-mono">
                <tr>
                  <th className="py-2.5">Link</th>
                  <th className="py-2.5">Bandwidth</th>
                  <th className="py-2.5">Delay</th>
                  <th className="py-2.5">Utilization</th>
                  <th className="py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredLinks.map((link) => {
                  const isSelected = activeLink?.linkId === link.linkId;
                  const isCongested = link.utilizationPct >= 50;

                  return (
                    <tr
                      key={link.linkId}
                      onClick={() => onSelectLink(link)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-cyber-cyan/15 text-white"
                          : "hover:bg-slate-800/40 text-slate-300"
                      }`}
                    >
                      <td className="py-2.5 font-bold">{link.linkId}</td>
                      <td className="py-2.5">{link.bandwidthMbps}M</td>
                      <td className="py-2.5">{link.latencyMs}ms</td>
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
                          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                            isCongested
                              ? "bg-rose-500/20 text-rose-400"
                              : "bg-emerald-500/20 text-emerald-400"
                          }`}
                        >
                          {isCongested ? "ALERT" : "OK"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Detailed Historical Time-Series Chart (7 cols) */}
        <div className="xl:col-span-7 flex flex-col rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
          <div className="flex items-center justify-between border-b border-noc-border pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-white">
                  Historical Telemetry: {activeLink?.linkId || "Select a link"}
                </span>
                {activeLink && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${
                      activeLink.utilizationPct >= 50
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                        : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    }`}
                  >
                    Current: {activeLink.utilizationPct.toFixed(1)}%
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Rolling 5-minute sampling history ({telemetryHistory.length} observations recorded)
              </p>
            </div>

            <div className="text-right text-xs">
              <span className="font-mono text-slate-400">Bandwidth: </span>
              <span className="font-mono text-white font-bold">
                {activeLink?.bandwidthMbps} Mbps
              </span>
            </div>
          </div>

          {/* Time-Series Chart */}
          <div className="mt-6 h-80 w-full">
            {isLoadingHistory ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                Loading telemetry stream...
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                No telemetry recorded for this link yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 10 }}
                >
                  <defs>
                    <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#00f0ff" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
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
                    formatter={(v: any) => [`${v}%`, "Utilization"]}
                  />
                  <ReferenceLine
                    y={50}
                    stroke="#f43f5e"
                    strokeDasharray="4 4"
                    label={{
                      value: "50% Congestion Gate",
                      fill: "#f43f5e",
                      fontSize: 11,
                      position: "top",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="utilization"
                    stroke="#00f0ff"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#utilGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Statistical Breakdown Bar */}
          <div className="mt-4 grid grid-cols-4 gap-3 border-t border-noc-border pt-4 text-xs font-mono">
            <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5 text-center">
              <span className="text-[10px] uppercase text-slate-400 block">Samples</span>
              <span className="text-sm font-bold text-white">{telemetryHistory.length}</span>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5 text-center">
              <span className="text-[10px] uppercase text-slate-400 block">Min</span>
              <span className="text-sm font-bold text-emerald-400">
                {telemetryHistory.length > 0
                  ? Math.min(...telemetryHistory.map((t) => t.utilizationPct)).toFixed(1) + "%"
                  : "N/A"}
              </span>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5 text-center">
              <span className="text-[10px] uppercase text-slate-400 block">Max Peak</span>
              <span className="text-sm font-bold text-rose-400">
                {telemetryHistory.length > 0
                  ? Math.max(...telemetryHistory.map((t) => t.utilizationPct)).toFixed(1) + "%"
                  : "N/A"}
              </span>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5 text-center">
              <span className="text-[10px] uppercase text-slate-400 block">Source</span>
              <span className="text-xs font-bold text-cyber-cyan uppercase">
                {telemetryHistory[0]?.source || "N/A"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

