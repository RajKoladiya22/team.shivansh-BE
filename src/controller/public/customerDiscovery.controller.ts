// src/controller/public/customerDiscovery.controller.ts

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";

/**
 * GET /api/v1/public/portal/discoveries
 * Customer Feed list of published, active discovery posts
 */
export async function getCustomerDiscoveries(req: Request, res: Response) {
  try {
    const customerId = req.customer?.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
    const skip = (page - 1) * limit;

    const { type, search } = req.query;

    const now = new Date();
    const where: any = {
      status: "PUBLISHED",
      isPublished: true,
      OR: [
        { publishAt: null },
        { publishAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { expireAt: null },
            { expireAt: { gt: now } },
          ],
        },
      ],
    };

    if (type && typeof type === "string") {
      where.discoveryType = type;
    }

    if (search && typeof search === "string" && search.trim()) {
      where.AND.push({
        OR: [
          { title: { contains: search.trim(), mode: "insensitive" } },
          { shortDescription: { contains: search.trim(), mode: "insensitive" } },
          { tags: { hasSome: [search.trim()] } },
        ],
      });
    }

    const [items, total] = await Promise.all([
      prisma.discovery.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { publishAt: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
        include: {
          createdByAcc: {
            select: { firstName: true, lastName: true, avatar: true },
          },
          likes: customerId
            ? {
                where: { customerId },
                select: { id: true },
              }
            : false,
        },
      }),
      prisma.discovery.count({ where }),
    ]);

    const formattedItems = items.map((item: any) => {
      const hasLiked = Boolean(item.likes && item.likes.length > 0);
      const { likes, ...rest } = item;
      return {
        ...rest,
        hasLiked,
      };
    });

    return sendSuccessResponse(res, 200, "Customer discovery feed fetched", {
      items: formattedItems,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("Get customer discoveries error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch discovery feed");
  }
}

/**
 * GET /api/v1/public/portal/discoveries/:id
 */
export async function getCustomerDiscoveryById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer?.id;

    const discovery = await prisma.discovery.findFirst({
      where: {
        id,
        status: "PUBLISHED",
        isPublished: true,
      },
      include: {
        createdByAcc: {
          select: { firstName: true, lastName: true, avatar: true },
        },
        likes: customerId
          ? {
              where: { customerId },
              select: { id: true },
            }
          : false,
      },
    });

    if (!discovery) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    // Record view asynchronously
    prisma.discoveryView
      .create({
        data: {
          discoveryId: id,
          customerId: customerId || null,
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        },
      })
      .then(() => {
        return prisma.discovery.update({
          where: { id },
          data: { views: { increment: 1 } },
        });
      })
      .catch((e) => console.error("Async discovery view record error:", e));

    const hasLiked = Boolean((discovery as any).likes && (discovery as any).likes.length > 0);
    const { likes, ...rest } = discovery as any;

    return sendSuccessResponse(res, 200, "Discovery details fetched", {
      ...rest,
      hasLiked,
    });
  } catch (err: any) {
    console.error("Get customer discovery by id error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch discovery detail");
  }
}

/**
 * POST /api/v1/public/portal/discoveries/:id/like
 * One-time like toggle / set per customer
 */
export async function likeDiscovery(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;

    const discovery = await prisma.discovery.findUnique({ where: { id } });
    if (!discovery || !discovery.isPublished) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    const existingLike = await prisma.discoveryLike.findUnique({
      where: {
        customerId_discoveryId: {
          customerId,
          discoveryId: id,
        },
      },
    });

    if (existingLike) {
      return sendSuccessResponse(res, 200, "Already liked", { likesCount: discovery.likesCount, hasLiked: true });
    }

    const [, updatedDiscovery] = await prisma.$transaction([
      prisma.discoveryLike.create({
        data: {
          customerId,
          discoveryId: id,
        },
      }),
      prisma.discovery.update({
        where: { id },
        data: { likesCount: { increment: 1 } },
        select: { likesCount: true },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Post liked successfully", {
      likesCount: updatedDiscovery.likesCount,
      hasLiked: true,
    });
  } catch (err: any) {
    console.error("Like discovery error:", err);
    return sendErrorResponse(res, 500, "Failed to like discovery post");
  }
}

/**
 * DELETE /api/v1/public/portal/discoveries/:id/like
 */
export async function unlikeDiscovery(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;

    const existingLike = await prisma.discoveryLike.findUnique({
      where: {
        customerId_discoveryId: {
          customerId,
          discoveryId: id,
        },
      },
    });

    if (!existingLike) {
      const discovery = await prisma.discovery.findUnique({ where: { id }, select: { likesCount: true } });
      return sendSuccessResponse(res, 200, "Not liked yet", { likesCount: discovery?.likesCount || 0, hasLiked: false });
    }

    const [, updatedDiscovery] = await prisma.$transaction([
      prisma.discoveryLike.delete({
        where: {
          id: existingLike.id,
        },
      }),
      prisma.discovery.update({
        where: { id },
        data: { likesCount: { decrement: 1 } },
        select: { likesCount: true },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Post unliked successfully", {
      likesCount: Math.max(0, updatedDiscovery.likesCount),
      hasLiked: false,
    });
  } catch (err: any) {
    console.error("Unlike discovery error:", err);
    return sendErrorResponse(res, 500, "Failed to unlike discovery post");
  }
}

/**
 * GET /api/v1/public/portal/discoveries/:id/comments
 */
export async function getDiscoveryComments(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      prisma.discoveryComment.findMany({
        where: { discoveryId: id, parentId: null },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          customer: {
            select: { id: true, name: true, customerCompanyName: true },
          },
          replies: {
            orderBy: { createdAt: "asc" },
            include: {
              customer: {
                select: { id: true, name: true, customerCompanyName: true },
              },
            },
          },
        },
      }),
      prisma.discoveryComment.count({ where: { discoveryId: id, parentId: null } }),
    ]);

    return sendSuccessResponse(res, 200, "Discovery comments fetched", {
      comments,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("Get discovery comments error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch comments");
  }
}

/**
 * POST /api/v1/public/portal/discoveries/:id/comment
 */
export async function addDiscoveryComment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;
    const { comment, parentId } = req.body;

    if (!comment || !comment.trim()) {
      return sendErrorResponse(res, 400, "Comment text is required");
    }

    const discovery = await prisma.discovery.findUnique({ where: { id } });
    if (!discovery || !discovery.isPublished) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    const [newComment] = await prisma.$transaction([
      prisma.discoveryComment.create({
        data: {
          discoveryId: id,
          customerId,
          comment: comment.trim(),
          parentId: parentId || null,
        },
        include: {
          customer: {
            select: { id: true, name: true, customerCompanyName: true },
          },
        },
      }),
      prisma.discovery.update({
        where: { id },
        data: { commentsCount: { increment: 1 } },
      }),
    ]);

    return sendSuccessResponse(res, 201, "Comment posted successfully", newComment);
  } catch (err: any) {
    console.error("Add discovery comment error:", err);
    return sendErrorResponse(res, 500, "Failed to post comment");
  }
}

/**
 * PATCH /api/v1/public/portal/discoveries/comments/:commentId
 */
export async function editDiscoveryComment(req: Request, res: Response) {
  try {
    const { commentId } = req.params;
    const customerId = req.customer.id;
    const { comment } = req.body;

    if (!comment || !comment.trim()) {
      return sendErrorResponse(res, 400, "Comment text is required");
    }

    const existing = await prisma.discoveryComment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return sendErrorResponse(res, 404, "Comment not found");
    }

    if (existing.customerId !== customerId) {
      return sendErrorResponse(res, 403, "You can only edit your own comment");
    }

    const updated = await prisma.discoveryComment.update({
      where: { id: commentId },
      data: {
        comment: comment.trim(),
        isEdited: true,
      },
      include: {
        customer: {
          select: { id: true, name: true, customerCompanyName: true },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Comment updated", updated);
  } catch (err: any) {
    console.error("Edit discovery comment error:", err);
    return sendErrorResponse(res, 500, "Failed to update comment");
  }
}

/**
 * DELETE /api/v1/public/portal/discoveries/comments/:commentId
 */
export async function deleteDiscoveryComment(req: Request, res: Response) {
  try {
    const { commentId } = req.params;
    const customerId = req.customer.id;

    const existing = await prisma.discoveryComment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return sendErrorResponse(res, 404, "Comment not found");
    }

    if (existing.customerId !== customerId) {
      return sendErrorResponse(res, 403, "You can only delete your own comment");
    }

    await prisma.$transaction([
      prisma.discoveryComment.delete({ where: { id: commentId } }),
      prisma.discovery.update({
        where: { id: existing.discoveryId },
        data: { commentsCount: { decrement: 1 } },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Comment deleted");
  } catch (err: any) {
    console.error("Delete discovery comment error:", err);
    return sendErrorResponse(res, 500, "Failed to delete comment");
  }
}
