import React, { useState } from "react";
import { Play, RotateCcw, FastForward, CheckCircle2, AlertCircle } from "lucide-react";
import { stepReplaySimulation, reseedDemoTopology } from "../../services/apiClient";

interface DemoControlBarProps {
  onDataChanged: () => void;
}

export const DemoControlBar: React.FC<DemoControlBarProps> = ({
  onDataChanged,
}) => {
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isReseeding, setIsReseeding] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);

  const showStatus = (text: string, type: "ok" | "err" = "ok") => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 5000);
  };

  const handleStepReplay = async () => {
    setIsAdvancing(true);
    try {
      const res = await stepReplaySimulation();
      showStatus(`Advanced simulation to ${new Date(res.timestamp).toLocaleTimeString()}: ${res.updatedLinks.length} links updated.`, "ok");
      onDataChanged();
    } catch (err: any) {
      showStatus(`Replay error: ${err.message}`, "err");
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleReseed = async () => {
    setIsReseeding(true);
    try {
      const summary = await reseedDemoTopology();
      showStatus(`Reseeded topology: ${summary.routerCount} routers, ${summary.linkCount} links, ${summary.telemetryCount} observations.`, "ok");
      onDataChanged();
    } catch (err: any) {
      showStatus(`Reseed error: ${err.message}`, "err");
    } finally {
      setIsReseeding(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-noc-border bg-slate-900/40 px-6 py-2.5 text-xs backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="flex h-2 w-2 rounded-full bg-cyber-cyan shadow-[0_0_6px_rgba(0,240,255,0.8)]" />
        <span className="font-semibold text-slate-300 uppercase tracking-wide">
          Demonstration Flight Controller:
        </span>
        <span className="text-slate-400">
          Deterministic 5-minute logical time stepping & topology control
        </span>
      </div>

      <div className="flex items-center gap-3">
        {statusMsg && (
          <div
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-mono transition-opacity ${
              statusMsg.type === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-rose-500/40 bg-rose-500/10 text-rose-400"
            }`}
          >
            {statusMsg.type === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <button
          onClick={handleStepReplay}
          disabled={isAdvancing}
          className="flex items-center gap-1.5 rounded-lg border border-cyber-cyan/50 bg-cyber-cyan/15 px-3 py-1.5 font-semibold text-cyber-cyan transition-all hover:bg-cyber-cyan/25 hover:shadow-[0_0_12px_rgba(0,240,255,0.3)] disabled:opacity-50"
        >
          <FastForward className="h-3.5 w-3.5" />
          <span>{isAdvancing ? "Stepping..." : "Step Replay (+5m)"}</span>
        </button>

        <button
          onClick={handleReseed}
          disabled={isReseeding}
          className="flex items-center gap-1.5 rounded-lg border border-noc-border bg-noc-card px-3 py-1.5 font-medium text-slate-300 transition-colors hover:border-noc-border-focus hover:bg-noc-card-hover hover:text-white disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{isReseeding ? "Reseeding..." : "Reseed Baseline"}</span>
        </button>
      </div>
    </div>
  );
};

