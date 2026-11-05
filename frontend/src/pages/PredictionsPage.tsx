import React, { useState } from "react";
import {
  Cpu,
  BrainCircuit,
  Zap,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Play,
} from "lucide-react";
import { Link, PredictionResponse } from "../types";
import { fetchLinkPrediction } from "../services/apiClient";

interface PredictionsPageProps {
  links: Link[];
  selectedLink: Link | null;
  onSelectLink: (link: Link) => void;
}

export const PredictionsPage: React.FC<PredictionsPageProps> = ({
  links,
  selectedLink,
  onSelectLink,
}) => {
  const [activeLinkId, setActiveLinkId] = useState<string>(
    selectedLink?.linkId || links[0]?.linkId || "L1-2"
  );
  const [predictionData, setPredictionData] = useState<{
    linkId: string;
    prediction: PredictionResponse;
    input: any;
  } | null>(null);
  const [isInferring, setIsInferring] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentLink = links.find((l) => l.linkId === activeLinkId) || links[0];

  const handleRunPrediction = async () => {
    if (!currentLink) return;
    setIsInferring(true);
    setErrorMsg(null);

    try {
      const res = await fetchLinkPrediction(currentLink.linkId, true);
      setPredictionData(res);
    } catch (err: any) {
      setErrorMsg(
        err.response?.data?.message || err.message || "Failed to fetch ML prediction"
      );
    } finally {
      setIsInferring(false);
    }
  };

  // Routing Cost Mathematical calculation (authoritative formula mirror)
  const calculateCostPreview = (util: number) => {
    if (util <= 50) return util.toFixed(2);
    const cost = util + 2.5 * Math.pow(util - 50, 1.3);
    return Math.min(200, cost).toFixed(2);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Top Architecture Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-cyber-cyan" />
            <h2 className="text-base font-bold text-white uppercase tracking-wider font-mono">
              Chronos-2 Foundation Prediction Engine
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Pretrained foundation model for univariate time-series forecasting. Zero-shot inference maps historical 5-minute sampling sequences directly to next-horizon link utilization.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="rounded border border-cyber-cyan/30 bg-cyber-cyan/10 px-2.5 py-1 text-cyber-cyan font-mono font-semibold">
            Model: amazon/chronos-2
          </div>
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-400 font-mono font-semibold">
            Horizon: Next 5-Min (+1 Step)
          </div>
        </div>
      </div>

      {/* Main Grid: Left Selector & Inspector, Right Model Breakdown */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Interactive Inference Sandbox (7 cols) */}
        <div className="xl:col-span-7 flex flex-col rounded-xl border border-noc-border bg-noc-card/90 p-6 backdrop-blur">
          <div className="flex items-center justify-between border-b border-noc-border pb-4">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
              Single-Link Forecast Sandbox
            </h3>
            <span className="text-xs text-slate-400">Live API Dispatch</span>
          </div>

          {/* Link Selector Tabs */}
          <div className="mt-4">
            <label className="text-xs text-slate-400 uppercase font-mono block mb-2">
              Select Network Link for Inference:
            </label>
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <button
                  key={link.linkId}
                  onClick={() => {
                    setActiveLinkId(link.linkId);
                    onSelectLink(link);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-mono font-bold transition-colors ${
                    activeLinkId === link.linkId
                      ? "border-cyber-cyan bg-cyber-cyan/20 text-white shadow-[0_0_10px_rgba(0,240,255,0.3)]"
                      : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {link.linkId} ({link.utilizationPct.toFixed(0)}%)
                </button>
              ))}
            </div>
          </div>

          {/* Action Trigger */}
          <div className="mt-6">
            <button
              onClick={handleRunPrediction}
              disabled={isInferring}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyber-cyan/50 bg-cyber-cyan/20 py-2.5 text-xs font-mono font-bold text-cyber-cyan transition-all hover:bg-cyber-cyan/30 hover:shadow-[0_0_15px_rgba(0,240,255,0.4)] disabled:opacity-50"
            >
              <Zap className={`h-4 w-4 ${isInferring ? "animate-spin" : ""}`} />
              <span>
                {isInferring
                  ? "Querying Python Chronos-2 Microservice..."
                  : `Trigger Forecast for Link ${currentLink?.linkId}`}
              </span>
            </button>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400 font-mono">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Live Result Display */}
          {predictionData ? (
            <div className="mt-6 space-y-4 rounded-xl border border-noc-border bg-slate-900/80 p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-mono text-xs font-bold uppercase text-slate-300">
                  ML Prediction Result ({predictionData.linkId})
                </span>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-400">
                  Status: {predictionData.prediction.status.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 font-mono text-xs">
                <div className="rounded border border-slate-800 bg-noc-card p-3">
                  <span className="text-[10px] text-slate-400 uppercase block">
                    Current Load
                  </span>
                  <span className="text-base font-bold text-slate-200">
                    {currentLink?.utilizationPct.toFixed(1)}%
                  </span>
                </div>
                <div className="rounded border border-cyber-cyan/40 bg-noc-card p-3">
                  <span className="text-[10px] text-cyber-cyan uppercase block">
                    Predicted (+5m)
                  </span>
                  <span className="text-base font-bold text-cyber-cyan">
                    {predictionData.prediction.predicted_utilization_percent.toFixed(1)}%
                  </span>
                </div>
                <div className="rounded border border-slate-800 bg-noc-card p-3">
                  <span className="text-[10px] text-slate-400 uppercase block">
                    Congestion Risk
                  </span>
                  <span
                    className={`text-base font-bold ${
                      predictionData.prediction.predicted_utilization_percent >= 50
                        ? "text-rose-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {predictionData.prediction.predicted_utilization_percent >= 50
                      ? "HIGH RISK"
                      : "LOW RISK"}
                  </span>
                </div>
                <div className="rounded border border-slate-800 bg-noc-card p-3">
                  <span className="text-[10px] text-slate-400 uppercase block">
                    Dijkstra Cost
                  </span>
                  <span className="text-base font-bold text-amber-400">
                    {calculateCostPreview(
                      predictionData.prediction.predicted_utilization_percent
                    )}
                  </span>
                </div>
              </div>

              {/* Confidence Interval & Hardware Metadata */}
              <div className="border-t border-slate-800 pt-3 text-xs text-slate-400 flex flex-wrap justify-between gap-2 font-mono text-[11px]">
                {predictionData.prediction.confidence_interval && (
                  <div>
                    Confidence Interval (80%):{" "}
                    <span className="text-slate-200">
                      [{predictionData.prediction.confidence_interval.lower.toFixed(1)}% –{" "}
                      {predictionData.prediction.confidence_interval.upper.toFixed(1)}%]
                    </span>
                  </div>
                )}
                <div>
                  Model:{" "}
                  <span className="text-cyber-cyan">
                    {predictionData.prediction.model}
                  </span>{" "}
                  ({predictionData.prediction.device || "cpu"})
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-12 text-center text-xs text-slate-500">
              <Cpu className="h-8 w-8 text-slate-600 mb-2" />
              <p>Click "Trigger Forecast" above to query Chronos-2 via the live backend.</p>
            </div>
          )}
        </div>

        {/* Right: Architectural & Policy Explainer (5 cols) */}
        <div className="xl:col-span-5 flex flex-col gap-6">
          {/* Piece-Wise Cost Formula Card */}
          <div className="rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider border-b border-noc-border pb-2.5">
              Routing Cost Policy Formula
            </h3>

            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 font-mono text-xs">
              <p className="text-slate-400 text-[10px] uppercase mb-1">
                Piece-wise Non-Linear Formulation:
              </p>
              <div className="space-y-2 text-slate-200">
                <p>
                  <span className="text-emerald-400">If U &le; 50%:</span> Cost = U
                </p>
                <p>
                  <span className="text-rose-400">If U &gt; 50%:</span> Cost = U + 2.5 &times; (U - 50)<sup>1.3</sup>
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2 text-xs text-slate-400">
              <p>
                • Below 50%, edge weight increases proportionally to utilization.
              </p>
              <p>
                • Above 50%, the cost escalates sharply, forcing Dijkstra to steer traffic onto lower-utilized alternative paths before packet dropping begins.
              </p>
            </div>
          </div>

          {/* Context Window Requirements */}
          <div className="rounded-xl border border-noc-border bg-noc-card/90 p-5 backdrop-blur">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider border-b border-noc-border pb-2.5">
              Context Window Specification
            </h3>

            <div className="mt-3 space-y-2.5 text-xs">
              <div className="flex justify-between border-b border-slate-800/60 pb-2">
                <span className="text-slate-400">Required History:</span>
                <span className="font-mono font-bold text-white">6 Observations</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/60 pb-2">
                <span className="text-slate-400">Sampling Cadence:</span>
                <span className="font-mono font-bold text-cyber-cyan">
                  5 Minutes (300s)
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-800/60 pb-2">
                <span className="text-slate-400">Interval Tolerance:</span>
                <span className="font-mono text-slate-200">±60 Seconds</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Scale:</span>
                <span className="font-mono font-bold text-emerald-400">
                  0.0% – 100.0%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

