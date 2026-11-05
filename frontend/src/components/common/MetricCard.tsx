import React from "react";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  badge?: string;
  badgeColor?: "emerald" | "amber" | "rose" | "cyan" | "slate";
  trend?: {
    direction: "up" | "down" | "neutral";
    text: string;
  };
  glow?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  badge,
  badgeColor = "cyan",
  trend,
  glow = false,
}) => {
  const badgeColors = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
    slate: "bg-slate-800 text-slate-400 border-slate-700",
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur transition-all duration-300 hover:border-noc-border-focus hover:bg-noc-card-hover ${
        glow ? "glow-cyan border-cyber-cyan/40" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {title}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
              {value}
            </span>
            {badge && (
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeColors[badgeColor]}`}
              >
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
          )}
          {trend && (
            <p className="mt-2 flex items-center text-xs text-slate-400 font-mono">
              <span
                className={`mr-1 font-semibold ${
                  trend.direction === "up"
                    ? "text-emerald-400"
                    : trend.direction === "down"
                    ? "text-rose-400"
                    : "text-slate-400"
                }`}
              >
                {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "•"}
              </span>
              {trend.text}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-noc-border bg-slate-900/60 p-2.5 text-cyber-cyan shadow-inner">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
};

