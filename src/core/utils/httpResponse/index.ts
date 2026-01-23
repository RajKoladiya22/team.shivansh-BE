// core/utils/httpResponse.ts
import { Response } from "express";

type Meta = Record<string, unknown> | undefined;

// Success Response
export const sendSuccessResponse = (
  res: Response,
  status: number,
  message: string,
  data: any = {},
  meta?: Meta
) => {
  return res.status(status).json({
    status,
    success: true,
    message,
    data,
    meta,
  });
};

// Error Response
export const sendErrorResponse = (
  res: Response,
  status: number,
  message: string,
  errors: any = {}
) => {
  return res.status(status).json({
    status,
    success: false,
    message,
    errors,
  });
};