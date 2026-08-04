import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket/index";

async function getAccountIdFromReqUser(user: any): Promise<string | null> {
  if (user?.accountId) return user.accountId;
  if (user?.id) {
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      select: { accountId: true },
    });
    return u?.accountId || null;
  }
  return null;
}

/** Emit socket helper safely */
function safeEmit(event: string, payload: any, projectId?: string) {
  try {
    const io = getIo();
    if (projectId) {
      io.to(`project:${projectId}`).emit(event, payload);
    }
    io.emit(event, payload);
  } catch (err) {
    console.warn(`[safeEmit] Failed to emit ${event}:`, err);
  }
}

/** Get all comments for a project (ordered by oldest first for chat thread) */
export async function listProjectComments(req: Request, res: Response) {
  try {
    const { id: projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) {
      return sendErrorResponse(res, 404, "Project not found");
    }

    const comments = await prisma.projectComment.findMany({
      where: { projectId, deletedAt: null },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            designation: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return sendSuccessResponse(res, 200, "Project comments fetched", comments);
  } catch (err: any) {
    console.error("[listProjectComments]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to list comments");
  }
}

/** Add a new comment to a project */
export async function addProjectComment(req: Request, res: Response) {
  try {
    const { id: projectId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return sendErrorResponse(res, 400, "Comment content is required");
    }

    const accountId = await getAccountIdFromReqUser(req.user);
    if (!accountId) {
      return sendErrorResponse(res, 401, "User account context missing");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) {
      return sendErrorResponse(res, 404, "Project not found");
    }

    const isAdmin = (req.user as any)?.roles?.includes("ADMIN") ?? false;
    if (!isAdmin) {
      const member = await prisma.projectMember.findFirst({
        where: { projectId, accountId },
      });
      if (member?.role === "VIEWER") {
        return sendErrorResponse(res, 403, "Viewers do not have permission to add comments");
      }
      if (!member && project.visibility === "PRIVATE") {
        return sendErrorResponse(res, 403, "You are not a member of this project");
      }
    }

    const comment = await prisma.projectComment.create({
      data: {
        projectId,
        authorId: accountId,
        content: content.trim(),
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            designation: true,
          },
        },
      },
    });

    safeEmit("project:comment:added", comment, projectId);

    return sendSuccessResponse(res, 201, "Comment added successfully", comment);
  } catch (err: any) {
    console.error("[addProjectComment]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to add comment");
  }
}

/** Update an existing comment (author only) */
export async function updateProjectComment(req: Request, res: Response) {
  try {
    const { id: projectId, commentId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return sendErrorResponse(res, 400, "Comment content is required");
    }

    const accountId = await getAccountIdFromReqUser(req.user);
    if (!accountId) {
      return sendErrorResponse(res, 401, "User account context missing");
    }

    const existing = await prisma.projectComment.findFirst({
      where: { id: commentId, projectId, deletedAt: null },
    });
    if (!existing) {
      return sendErrorResponse(res, 404, "Comment not found");
    }

    if (existing.authorId !== accountId) {
      return sendErrorResponse(res, 403, "You can only edit your own comments");
    }

    const updated = await prisma.projectComment.update({
      where: { id: commentId },
      data: {
        content: content.trim(),
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            designation: true,
          },
        },
      },
    });

    safeEmit("project:comment:updated", updated, projectId);

    return sendSuccessResponse(res, 200, "Comment updated successfully", updated);
  } catch (err: any) {
    console.error("[updateProjectComment]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to update comment");
  }
}

/** Delete a comment (author or admin only) */
export async function deleteProjectComment(req: Request, res: Response) {
  try {
    const { id: projectId, commentId } = req.params;

    const accountId = await getAccountIdFromReqUser(req.user);
    if (!accountId) {
      return sendErrorResponse(res, 401, "User account context missing");
    }

    const existing = await prisma.projectComment.findFirst({
      where: { id: commentId, projectId, deletedAt: null },
    });
    if (!existing) {
      return sendErrorResponse(res, 404, "Comment not found");
    }

    const isAdmin = (req.user as any)?.roles?.includes("ADMIN") ?? false;
    if (existing.authorId !== accountId && !isAdmin) {
      return sendErrorResponse(res, 403, "You can only delete your own comments");
    }

    await prisma.projectComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    const payload = { projectId, commentId };
    safeEmit("project:comment:deleted", payload, projectId);

    return sendSuccessResponse(res, 200, "Comment deleted successfully", payload);
  } catch (err: any) {
    console.error("[deleteProjectComment]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to delete comment");
  }
}
