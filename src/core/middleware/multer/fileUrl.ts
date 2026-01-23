// src/core/utils/fileUrl.ts
import { Request } from "express";

export function buildFileUrl(
  req: Request,
  userId: string,
  filename?: string | null
) {
  if (!filename) return null;

  return `${req.protocol}://${req.get("host")}/storage/${userId}/${filename}`;
}
