import React, { useState, useMemo } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Activity,
  Server,
  Zap,
  ShieldAlert,
  ArrowRight,
  Info,
} from "lucide-react";
import { Router, Link } from "../../types";

interface NetworkTopologyGraphProps {
  routers: Router[];
  links: Link[];
  activeLinkPath?: string[];
  conventionalLinkPath?: string[];
  onSelectLink?: (link: Link) => void;
  onSelectRouter?: (router: Router) => void;
  selectedLinkId?: string | null;
  selectedRouterId?: string | null;
}

// 2D Coordinates for the 6 Core Routers
const ROUTER_COORDINATES: Record<string, { x: number; y: number; label: string }> = {
  R1: { x: 160, y: 130, label: "New York (R1)" },
  R2: { x: 420, y: 110, label: "Chicago (R2)" },
  R3: { x: 220, y: 350, label: "Atlanta (R3)" },
  R4: { x: 480, y: 330, label: "Dallas (R4)" },
  R5: { x: 720, y: 140, label: "Denver (R5)" },
  R6: { x: 800, y: 350, label: "San Jose (R6)" },
};

export const NetworkTopologyGraph: React.FC<NetworkTopologyGraphProps> = ({
  routers,
  links,
  activeLinkPath = [],
  conventionalLinkPath = [],
  onSelectLink,
  onSelectRouter,
  selectedLinkId,
  selectedRouterId,
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const routerMap = useMemo(() => {
    const map = new Map<string, Router>();
    routers.forEach((r) => map.set(r.routerId, r));
    return map;
  }, [routers]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Helper to determine link stroke color
  const getLinkStatus = (utilization: number) => {
    if (utilization >= 50) {
      return {
        color: "#f43f5e", // Rose (Congested)
        glow: "rgba(244, 63, 94, 0.6)",
        status: "HIGH RISK",
      };
    }
    if (utilization >= 40) {
      return {
        color: "#f59e0b", // Amber (Moderate)
        glow: "rgba(245, 158, 11, 0.5)",
        status: "MODERATE",
      };
    }
    return {
      color: "#10b981", // Emerald (Low/Healthy)
      glow: "rgba(16, 185, 129, 0.4)",
      status: "LOW",
    };
  };

  return (
    <div className="relative flex h-[520px] w-full flex-col overflow-hidden rounded-xl border border-noc-border bg-noc-card/90 backdrop-blur">
      {/* Topology Header Controls */}
      <div className="flex items-center justify-between border-b border-noc-border bg-slate-900/60 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyber-cyan" />
          <span className="font-semibold uppercase tracking-wider text-slate-200">
            Interactive Network Topology
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            6 Nodes | 8 Core Links
          </span>
        </div>

        {/* Zoom & Reset Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.15, 0.6))}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={resetView}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Reset View"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div
        className="relative flex-1 cursor-grab active:cursor-grabbing noc-grid overflow-hidden select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          viewBox="0 0 960 480"
          className="h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.1s ease-out",
          }}
        >
          <defs>
            <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* 1. Links (Lines between routers) */}
          {links.map((link) => {
            const srcId =
              typeof link.sourceRouter === "object"
                ? link.sourceRouter.routerId
                : link.sourceRouter;
            const dstId =
              typeof link.destinationRouter === "object"
                ? link.destinationRouter.routerId
                : link.destinationRouter;

            const srcCoords = ROUTER_COORDINATES[srcId];
            const dstCoords = ROUTER_COORDINATES[dstId];

            if (!srcCoords || !dstCoords) return null;

            const isSelected = selectedLinkId === link.linkId;
            const isActivePath = activeLinkPath.includes(link.linkId);
            const isConventionalPath = conventionalLinkPath.includes(link.linkId);

            const { color, glow } = getLinkStatus(link.utilizationPct);

            const midX = (srcCoords.x + dstCoords.x) / 2;
            const midY = (srcCoords.y + dstCoords.y) / 2;

            return (
              <g
                key={link.linkId}
                className="cursor-pointer transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLink?.(link);
                }}
              >
                {/* Background selection highlight */}
                {isSelected && (
                  <line
                    x1={srcCoords.x}
                    y1={srcCoords.y}
                    x2={dstCoords.x}
                    y2={dstCoords.y}
                    stroke="#00f0ff"
                    strokeWidth="10"
                    strokeOpacity="0.4"
                    strokeLinecap="round"
                  />
                )}

                {/* Base Link Line */}
                <line
                  x1={srcCoords.x}
                  y1={srcCoords.y}
                  x2={dstCoords.x}
                  y2={dstCoords.y}
                  stroke={color}
                  strokeWidth={isSelected ? "4" : "2.5"}
                  strokeOpacity="0.85"
                  strokeLinecap="round"
                />

                {/* Active Path Pulsing Overlay */}
                {isActivePath && (
                  <line
                    x1={srcCoords.x}
                    y1={srcCoords.y}
                    x2={dstCoords.x}
                    y2={dstCoords.y}
                    stroke="#00f0ff"
                    strokeWidth="3.5"
                    strokeDasharray="8 6"
                    className="animate-pulse"
                    filter="url(#glow-cyan)"
                  />
                )}

                {/* Conventional Path Overlay (if different) */}
                {isConventionalPath && !isActivePath && (
                  <line
                    x1={srcCoords.x}
                    y1={srcCoords.y}
                    x2={dstCoords.x}
                    y2={dstCoords.y}
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    strokeOpacity="0.75"
                  />
                )}

                {/* Metric Badge at Link Midpoint */}
                <rect
                  x={midX - 22}
                  y={midY - 11}
                  width="44"
                  height="22"
                  rx="4"
                  fill="#070b14"
                  stroke={isSelected ? "#00f0ff" : color}
                  strokeWidth="1.2"
                  className="shadow-md"
                />
                <text
                  x={midX}
                  y={midY + 4}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontFamily="JetBrains Mono"
                  fontWeight="600"
                >
                  {link.utilizationPct.toFixed(1)}%
                </text>
              </g>
            );
          })}

          {/* 2. Routers (Nodes) */}
          {Object.entries(ROUTER_COORDINATES).map(([routerId, coords]) => {
            const router = routerMap.get(routerId);
            const isSelected = selectedRouterId === routerId;

            return (
              <g
                key={routerId}
                transform={`translate(${coords.x}, ${coords.y})`}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (router) onSelectRouter?.(router);
                }}
              >
                {/* Outer Glow on selection */}
                {isSelected && (
                  <circle
                    r="28"
                    fill="none"
                    stroke="#00f0ff"
                    strokeWidth="2"
                    strokeOpacity="0.6"
                    className="animate-pulse"
                  />
                )}

                {/* Outer Ring */}
                <circle
                  r="20"
                  fill="#0d1424"
                  stroke={isSelected ? "#00f0ff" : "#2a4365"}
                  strokeWidth={isSelected ? "2.5" : "1.8"}
                  filter="url(#glow-cyan)"
                />

                {/* Inner Core */}
                <circle
                  r="13"
                  fill={isSelected ? "#00f0ff" : "#1e293b"}
                  fillOpacity={isSelected ? "0.3" : "0.8"}
                />

                {/* Router Glyph Icon / Text */}
                <text
                  textAnchor="middle"
                  dy=".35em"
                  fill={isSelected ? "#00f0ff" : "#e2e8f0"}
                  fontSize="11"
                  fontWeight="bold"
                  fontFamily="JetBrains Mono"
                >
                  {routerId}
                </text>

                {/* Router Name Label */}
                <text
                  y="32"
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="11"
                  fontWeight="500"
                  className="select-none"
                >
                  {coords.label}
                </text>

                {/* IP Address Label */}
                {router && (
                  <text
                    y="44"
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="JetBrains Mono"
                  >
                    {router.ipAddress}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Selected Link / Node Quick Panel (Bottom-Left Overlay) */}
        {selectedLinkId && (
          <div className="absolute bottom-3 left-3 z-10 w-72 rounded-lg border border-noc-border bg-slate-950/95 p-3.5 shadow-2xl backdrop-blur">
            {(() => {
              const link = links.find((l) => l.linkId === selectedLinkId);
              if (!link) return null;
              const { status, color } = getLinkStatus(link.utilizationPct);

              return (
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-mono text-sm font-bold text-white">
                      Link: {link.linkId}
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ color, backgroundColor: `${color}20` }}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="mt-2.5 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Current Utilization:</span>
                      <span className="font-mono font-bold text-white">
                        {link.utilizationPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Bandwidth / Capacity:</span>
                      <span className="font-mono text-slate-200">
                        {link.bandwidthMbps} Mbps
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Latency:</span>
                      <span className="font-mono text-slate-200">
                        {link.latencyMs} ms
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Legend Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-noc-border bg-slate-900/60 px-4 py-2 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-slate-300">Low Load (&lt;40%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-slate-300">Moderate (40–49%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
            <span className="text-rose-400 font-semibold">High Risk (&ge;50%)</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded bg-cyber-cyan shadow-[0_0_6px_rgba(0,240,255,0.8)]" />
            <span className="text-cyber-cyan font-semibold">Adaptive Route</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded bg-amber-400/70" />
            <span className="text-slate-400">Conventional Route</span>
          </div>
        </div>
      </div>
    </div>
  );
};

