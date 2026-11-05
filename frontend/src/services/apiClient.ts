import axios from "axios";
import {
  Router,
  Link,
  TelemetryObservation,
  PredictionResponse,
  RoutingDecision,
  SystemHealth,
  Gns3Status,
  DemoState,
} from "../types";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:5001/api";

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
export const fetchSystemHealth = async (): Promise<SystemHealth> => {
  const res = await client.get<SystemHealth>("/health");
  return res.data;
};

// ---------------------------------------------------------------------------
// Unified Demo Controller API (Source of Truth)
// ---------------------------------------------------------------------------
export const fetchDemoState = async (): Promise<DemoState> => {
  const res = await client.get<{ success: boolean; data: DemoState }>("/demo/state");
  return res.data.data;
};

export const initializeDemo = async (): Promise<DemoState> => {
  const res = await client.post<{ success: boolean; data: DemoState }>("/demo/initialize");
  return res.data.data;
};

export const stepDemo = async (): Promise<DemoState> => {
  const res = await client.post<{ success: boolean; data: DemoState }>("/demo/step");
  return res.data.data;
};

export const resetDemo = async (): Promise<DemoState> => {
  const res = await client.post<{ success: boolean; data: DemoState }>("/demo/reset");
  return res.data.data;
};

export const runDemo = async (): Promise<DemoState> => {
  const res = await client.post<{ success: boolean; data: DemoState }>("/demo/run");
  return res.data.data;
};

// ---------------------------------------------------------------------------
// Topology, Routers & Links
// ---------------------------------------------------------------------------
export const fetchTopology = async (): Promise<{
  routers: Router[];
  links: Link[];
  summary: {
    totalRouters: number;
    totalLinks: number;
    activeRouters: number;
    activeLinks: number;
  };
}> => {
  const res = await client.get<{
    success: boolean;
    data: {
      routers: Router[];
      links: Link[];
      summary: {
        totalRouters: number;
        totalLinks: number;
        activeRouters: number;
        activeLinks: number;
      };
    };
  }>("/topology");
  return res.data.data;
};

export const fetchRouters = async (): Promise<Router[]> => {
  const res = await client.get<{ success: boolean; data: Router[] }>("/routers");
  return res.data.data;
};

export const fetchLinks = async (): Promise<Link[]> => {
  const res = await client.get<{ success: boolean; data: Link[] }>("/links");
  return res.data.data;
};

// ---------------------------------------------------------------------------
// Telemetry & Demo Controls
// ---------------------------------------------------------------------------
export const fetchTelemetryForLink = async (
  linkId: string,
  limit: number = 100
): Promise<{
  link: { linkId: string; bandwidthMbps: number; currentUtilizationPct: number };
  count: number;
  data: TelemetryObservation[];
}> => {
  const res = await client.get<{
    success: boolean;
    link: { linkId: string; bandwidthMbps: number; currentUtilizationPct: number };
    count: number;
    data: TelemetryObservation[];
  }>(`/telemetry/link/${encodeURIComponent(linkId)}?limit=${limit}`);
  return res.data;
};

export const stepReplaySimulation = async (): Promise<{
  timestamp: string;
  updatedLinks: Array<{ linkId: string; utilizationPct: number; source: string }>;
}> => {
  const res = await client.post<{
    success: boolean;
    data: {
      timestamp: string;
      updatedLinks: Array<{ linkId: string; utilizationPct: number; source: string }>;
    };
  }>("/telemetry/replay-step");
  return res.data.data;
};

export const reseedDemoTopology = async (): Promise<{
  routerCount: number;
  linkCount: number;
  telemetryCount: number;
}> => {
  const res = await client.post<{
    success: boolean;
    data: { routerCount: number; linkCount: number; telemetryCount: number };
  }>("/telemetry/seed");
  return res.data.data;
};

// ---------------------------------------------------------------------------
// ML Prediction Layer
// ---------------------------------------------------------------------------
export const fetchLinkPrediction = async (
  linkId: string,
  allowFallback: boolean = true
): Promise<{
  linkId: string;
  prediction: PredictionResponse;
  input: {
    observationsUsed: number;
    intervalMinutes: number;
    capacityKbps: number;
    trafficKbps: number;
    mlLinkIndex: number;
  };
}> => {
  const res = await client.post<{
    success: boolean;
    linkId: string;
    prediction: PredictionResponse;
    input: {
      observationsUsed: number;
      intervalMinutes: number;
      capacityKbps: number;
      trafficKbps: number;
      mlLinkIndex: number;
    };
  }>(`/predictions/${encodeURIComponent(linkId)}?allow_fallback=${allowFallback}`);
  return res.data;
};

// ---------------------------------------------------------------------------
// Routing Engine
// ---------------------------------------------------------------------------
export const computeAdaptiveRoute = async (
  sourceRouter: string,
  destinationRouter: string
): Promise<RoutingDecision> => {
  const res = await client.post<{
    success: boolean;
    decision: RoutingDecision;
  }>("/routing/compute", {
    sourceRouter,
    destinationRouter,
  });
  return res.data.decision;
};

export const fetchRoutingDecisions = async (
  limit: number = 20
): Promise<RoutingDecision[]> => {
  const res = await client.get<{
    success: boolean;
    data: RoutingDecision[];
  }>(`/routing/decisions?limit=${limit}`);
  return res.data.data;
};

// ---------------------------------------------------------------------------
// GNS3 Subsystem
// ---------------------------------------------------------------------------
export const fetchGns3Status = async (): Promise<Gns3Status> => {
  const res = await client.get<{
    success: boolean;
    data: Gns3Status;
  }>("/gns3/status");
  return res.data.data;
};

export const applyRouteToGns3 = async (payload: {
  sourceRouter: string;
  destinationRouter: string;
  routerPath: string[];
  linkPath: string[];
}): Promise<{
  applied: boolean;
  message: string;
}> => {
  const res = await client.post<{
    success: boolean;
    message: string;
  }>("/gns3/apply-route", payload);
  return {
    applied: res.data.success,
    message: res.data.message,
  };
};
