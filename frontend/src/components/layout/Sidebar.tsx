import React from "react";
import {
  LayoutDashboard,
  Network,
  Activity,
  Cpu,
  Route,
  FlaskConical,
  ShieldCheck,
  HardDrive,
} from "lucide-react";

export type NavTab =
  | "overview"
  | "topology"
  | "monitoring"
  | "predictions"
  | "routing"
  | "experiments"
  | "health";

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  storageMode: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  storageMode,
}) => {
  const navItems = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "topology", label: "Network Topology", icon: Network },
    { id: "monitoring", label: "Traffic Monitoring", icon: Activity },
    { id: "predictions", label: "Prediction Intelligence", icon: Cpu },
    { id: "routing", label: "Adaptive Routing", icon: Route },
    { id: "experiments", label: "Experiments & Analytics", icon: FlaskConical },
    { id: "health", label: "System Health", icon: ShieldCheck },
  ] as const;

  return (
    <aside className="flex w-64 flex-col justify-between border-r border-noc-border bg-noc-card/70 p-4 backdrop-blur">
      <div>
        <div className="mb-4 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Network Operations Center
        </div>
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`group flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "border border-cyber-cyan/40 bg-cyber-cyan/10 text-white shadow-[0_0_15px_-4px_rgba(0,240,255,0.4)]"
                    : "text-slate-400 hover:border-noc-border hover:bg-noc-card-hover hover:text-slate-200"
                }`}
              >
                <Icon
                  className={`h-4 w-4 transition-colors ${
                    isActive
                      ? "text-cyber-cyan"
                      : "text-slate-400 group-hover:text-slate-200"
                  }`}
                />
                <span>{item.label}</span>
                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyber-cyan shadow-[0_0_6px_rgba(0,240,255,1)]" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Storage & Environment Footer Card */}
      <div className="rounded-lg border border-noc-border bg-slate-900/60 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-300">
          <HardDrive className="h-3.5 w-3.5 text-cyber-cyan" />
          <span>Storage Engine</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-slate-400">Mode:</span>
          <span className="font-mono font-bold text-cyber-cyan uppercase">
            {storageMode}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-slate-400">Target Port:</span>
          <span className="font-mono text-slate-300">5001</span>
        </div>
        <div className="mt-2 border-t border-noc-border pt-2 text-[10px] text-slate-400">
          Demonstration Architecture (No MongoDB Required)
        </div>
      </div>
    </aside>
  );
};

