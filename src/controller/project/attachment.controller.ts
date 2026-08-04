import { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";

/** Upload a project attachment file to src/storage/projectAttachment/<ext>/<filename> */
export async function uploadProjectAttachmentFile(req: Request, res: Response) {
  try {
    const file = req.file;
    if (!file) {
      return sendErrorResponse(res, 400, "No file uploaded");
    }

    const ext = path.extname(file.originalname).replace(".", "").toLowerCase() || "other";
    const relativeUrl = `/storage/projectAttachment/${ext}/${file.filename}`;

    return sendSuccessResponse(res, 200, "File uploaded successfully", {
      name: file.originalname,
      url: relativeUrl,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      ext,
    });
  } catch (err: any) {
    console.error("[uploadProjectAttachmentFile]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to upload file");
  }
}

export async function addProjectAttachment(req: Request, res: Response) {
  try {
    const { id: projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) {
      return sendErrorResponse(res, 404, "Project not found");
    }

    const items = Array.isArray(req.body.attachments)
      ? req.body.attachments
      : [req.body];

    const createdList: any[] = [];
    for (const item of items) {
      const { name, source, url, mimeType, sizeBytes, meta, description } = item;
      if (!name || !url) continue;

      const metaObj = (typeof meta === "object" && meta !== null) ? { ...meta } : {};
      if (description) {
        metaObj.description = String(description).trim();
      }

      const att = await prisma.projectAttachment.create({
        data: {
          projectId,
          name,
          source: source || "UPLOAD",
          url,
          mimeType: mimeType || null,
          sizeBytes: sizeBytes ? Number(sizeBytes) : null,
          meta: Object.keys(metaObj).length > 0 ? metaObj : null,
          uploadedBy: req.user?.accountId ?? null,
        },
      });
      createdList.push(att);
    }

    if (createdList.length === 0) {
      return sendErrorResponse(res, 400, "Valid name and URL are required");
    }

    return sendSuccessResponse(
      res,
      201,
      createdList.length === 1 ? "Attachment added to project" : "Attachments added to project",
      createdList.length === 1 ? createdList[0] : createdList
    );
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
      where: { id: attachmentId, projectId },
    });
    if (!attachment) {
      return sendErrorResponse(res, 404, "Attachment not found");
    }

    // Unlink physical file from disk storage if available
    if (attachment.url) {
      const relativePath = attachment.url.startsWith("/") ? attachment.url.slice(1) : attachment.url;
      const possiblePaths = [
        path.join(process.cwd(), "src", relativePath),
        path.join(process.cwd(), relativePath),
        path.join(__dirname, "../../../", relativePath),
      ];
      for (const absolutePath of possiblePaths) {
        if (fs.existsSync(absolutePath)) {
          try {
            fs.unlinkSync(absolutePath);
            console.log(`[deleteProjectAttachment] Physical file unlinked: ${absolutePath}`);
            break;
          } catch (unlinkErr) {
            console.warn(`[deleteProjectAttachment] Failed to unlink ${absolutePath}:`, unlinkErr);
          }
        }
      }
    }

    // Delete record from database
    await prisma.projectAttachment.delete({
      where: { id: attachmentId },
    }).catch(async () => {
      await prisma.projectAttachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      });
    });

    return sendSuccessResponse(res, 200, "Attachment deleted successfully");
  } catch (err: any) {
    console.error("[deleteProjectAttachment]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to delete attachment");
  }
}
