import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { API_PATHS } from "@subscript/shared";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestId } from "./middleware/request-id.js";
import { healthHandler } from "./routes/health.js";

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
] as const;

export interface AppOptions {
  corsOrigins?: readonly string[];
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const allowedOrigins = [...(options.corsOrigins ?? DEFAULT_CORS_ORIGINS)];

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "64kb", strict: true }));

  app.get(API_PATHS.health, healthHandler);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
