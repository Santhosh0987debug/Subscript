import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError(
      404,
      "NOT_FOUND",
      `No route matches ${req.method} ${req.path}.`,
    ),
  );
};
