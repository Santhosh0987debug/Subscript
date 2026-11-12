import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Accepts a valid caller-supplied request id for distributed tracing, otherwise
 * generates one. Invalid or oversized values are ignored instead of reflected.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const supplied = req.get("x-request-id");
  const id = supplied && UUID_PATTERN.test(supplied) ? supplied : randomUUID();

  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);

  const correlationId = req.get("x-correlation-id");

  if (correlationId && CORRELATION_PATTERN.test(correlationId)) {
    res.locals.correlationId = correlationId;
    res.setHeader("X-Correlation-Id", correlationId);
  }

  next();
};
