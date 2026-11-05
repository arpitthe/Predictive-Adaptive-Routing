/**
 * Frontend Type Definitions
 *
 * Mapped directly to Node.js backend models and Python Chronos-2 schemas.
 */

export interface Router {
  _id: string;
  routerId: string;
  name: string;
  ipAddress: string;
  status: "active" | "inactive" | "maintenance";
  location?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Link {
  _id: string;
  linkId: string;
  sourceRouter: Router | string;
  destinationRouter: Router | string;
  bandwidthMbps: number;
  latencyMs: number;
  utilizationPct: number;
  status: "active" | "inactive";
  mlLinkIndex?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TelemetryObservation {
  _id: string;
  link: string;
  linkId: string;
  utilizationPct: number;
  throughputMbps: number | null;
  packetLossPct: number | null;
  source: "manual" | "simulator" | "gns3" | "demo_seed" | "replay";
  measuredAt: string;
  createdAt?: string;
}

export interface PredictionResponse {
  status: "ok" | "error";
  link: string;
  predicted_utilization_percent: number;
  confidence_interval?: {
    lower: number;
    upper: number;
  };
  model: string;
  device?: string;
  latency_ms?: number;
  error?: string;
}

export interface EvaluatedLink {
  linkId: string;
  predictedUtilizationPct: number;
  congestionRisk: "LOW" | "HIGH" | "UNKNOWN";
  routingCost: number;
  predictionStatus?: "ok" | "error" | "insufficient_history" | "simulated_fallback";
  predictionModel?: string | null;
  predictionError?: string | null;
}

export interface RoutingDecision {
  _id: string;
  sourceRouter: string;
  destinationRouter: string;
  routerPath: string[];
  linkPath: string[];
  totalCost: number;
  evaluatedLinks: EvaluatedLink[];
  algorithm: string;
  routingPolicy: string;
  createdAt: string;
}

export interface SystemHealth {
  success: boolean;
  status: "healthy" | "degraded";
  message: string;
  backend: string;
  storageMode: "memory" | "mongodb";
  storage: {
    mode: "memory" | "mongodb";
    status: string;
    routerCount?: number;
    linkCount?: number;
    telemetryCount?: number;
    decisionCount?: number;
    database?: string;
  };
  mlService: {
    available: boolean;
    modelLoaded: boolean;
    modelId: string | null;
    device: string | null;
    error: string | null;
  };
  gns3: {
    connected: boolean;
    status: "online" | "standby" | "misconfigured";
    serverUrl?: string;
    projectId?: string;
    version?: string | null;
    projectName?: string | null;
    note: string;
  };
  timestamp: string;
}

export interface Gns3Status {
  connected: boolean;
  status: "online" | "standby" | "misconfigured";
  serverUrl: string;
  projectId: string;
  version: string | null;
  projectName: string | null;
  note: string;
  error?: string | null;
}

export interface DemoState {
  initialized: boolean;
  stage: number;
  stageTitle: string;
  stageDescription: string;
  stepCount: number;
  lastUpdated: string;
  eventHistory: Array<{
    id: string;
    timestamp: string;
    type: string;
    title: string;
    description: string;
  }>;
  bottleneckLink: string;
  conventionalRoute: {
    path: string[];
    links: string[];
    totalCost: number;
    simulatedLatencyMs: number;
    status: string;
  };
  predictiveRoute: {
    path: string[];
    links: string[];
    totalCost: number;
    simulatedLatencyMs: number;
    status: string;
  };
  routeSwitched: boolean;
  bottleneckAvoided: string | null;
  experiments: {
    conventionalAvgLatency: number;
    predictiveAvgLatency: number;
    peakConventionalUtilization: number;
    peakPredictiveUtilization: number;
    congestionEventsAvoided: number;
    timeSeries: Array<{
      step: string;
      conventionalLatency: number;
      predictiveLatency: number;
      conventionalBottleneckUtil: number;
      predictiveBottleneckUtil: number;
    }>;
  };
  routers: Router[];
  links: Link[];
  gns3: Gns3Status;
  mlService: {
    available: boolean;
    modelLoaded: boolean;
    modelId: string;
    horizonMinutes: number;
  };
}
