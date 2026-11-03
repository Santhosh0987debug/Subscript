import type { RequestHandler } from "express";
import type { HealthResponse } from "@subscript/shared";

const SERVICE_VERSION = "0.1.0";

export const healthHandler: RequestHandler = (_req, res) => {
  const payload: HealthResponse = {
    status: "ok",
    service: "subscript-api",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(payload);
};
