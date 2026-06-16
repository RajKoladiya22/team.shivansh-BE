import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";

export async function addProjectAttachment(req: Request, res: Response) {
  try {
    const { id: projectId } = req.params;
    const { name, source, url, mimeType, sizeBytes, meta } = req.body;

    if (!name || !url) {
      return sendErrorResponse(res, 400, "Name and URL are required");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) {
      return sendErrorResponse(res, 404, "Project not found");
    }

    const attachment = await prisma.projectAttachment.create({
      data: {
        projectId,
        name,
        source: source || "UPLOAD",
        url,
        mimeType: mimeType || null,
        sizeBytes: sizeBytes ? Number(sizeBytes) : null,
        meta: meta || null,
        uploadedBy: req.user?.accountId ?? null,
      },
    });

    return sendSuccessResponse(res, 201, "Attachment added to project", attachment);
  } catch (err: any) {
    console.error("[addProjectAttachment]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to add attachment");
  }
}

export async function listProjectAttachments(req: Request, res: Response) {
  try {
    const { id: projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) {
      return sendErrorResponse(res, 404, "Project not found");
    }

    const attachments = await prisma.projectAttachment.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccessResponse(res, 200, "Project attachments fetched", attachments);
  } catch (err: any) {
    console.error("[listProjectAttachments]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to list attachments");
  }
}

export async function deleteProjectAttachment(req: Request, res: Response) {
  try {
    const { id: projectId, attachmentId } = req.params;

    const attachment = await prisma.projectAttachment.findFirst({
      where: { id: attachmentId, projectId, deletedAt: null },
    });
    if (!attachment) {
      return sendErrorResponse(res, 404, "Attachment not found");
    }

    await prisma.projectAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });

    return sendSuccessResponse(res, 200, "Attachment deleted");
  } catch (err: any) {
    console.error("[deleteProjectAttachment]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to delete attachment");
  }
}
