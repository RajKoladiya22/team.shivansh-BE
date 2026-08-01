// src/controller/admin/discovery.controller.ts

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import webpush from "web-push";

/**
 * Generate URL-friendly slug from title
 */
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w\-]+/g, "") // Remove all non-word chars
    .replace(/\-\-+/g, "-") // Replace multiple - with single -
    .replace(/^-+/, "") // Trim - from start of text
    .replace(/-+$/, ""); // Trim - from end of text
}

/**
 * Helper to dispatch push notifications to all customer devices when published
 */
async function notifyCustomersNewDiscovery(discovery: any) {
  try {
    // 1. Emit Socket.IO event if connected
    try {
      const io = getIo();
      if (io) {
        io.emit("discovery:new", {
          id: discovery.id,
          title: discovery.title,
          discoveryType: discovery.discoveryType,
          shortDescription: discovery.shortDescription,
          createdAt: discovery.createdAt,
        });
      }
    } catch (e) {
      // socket io might not be initialized
    }

    // 2. Fetch all customer notification subscriptions
    const subscriptions = await prisma.notificationSubscription.findMany({
      where: { customerId: { not: null } },
    });

    if (!subscriptions || subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title: `🚀 ${discovery.title}`,
      body: discovery.shortDescription || "New post in Shivansh Infosys Discovery feed!",
      data: {
        url: `/discovery/${discovery.id}`,
        discoveryId: discovery.id,
      },
    });

    for (const sub of subscriptions) {
      try {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };
        await webpush.sendNotification(pushSub, payload, {
          TTL: 3600,
          headers: { urgency: "high" },
        });
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.notificationSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("Failed to notify customers of discovery:", err);
  }
}

/**
 * POST /api/v1/admin/discoveries
 */
export async function createDiscovery(req: Request, res: Response) {
  try {
    const {
      title,
      shortDescription,
      content,
      discoveryType,
      imageUrls,
      youtubeUrl,
      externalUrl,
      tags,
      status,
      publishAt,
      expireAt,
      isPinned,
      sendNotification,
    } = req.body;

    if (!title || !title.trim()) {
      return sendErrorResponse(res, 400, "Title is required");
    }

    const accountId = req.user?.accountId;
    let baseSlug = slugify(title);
    let slug = baseSlug;

    // Check slug uniqueness
    const existing = await prisma.discovery.findUnique({ where: { slug } });
    if (existing) {
      slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
    }

    const reqPublishAt = publishAt ? new Date(publishAt) : null;
    const isPub = status === "PUBLISHED" || (status === "SCHEDULED" && (!reqPublishAt || reqPublishAt <= new Date()));
    const finalPublishAt = isPub && !reqPublishAt ? new Date() : reqPublishAt;
    const finalStatus = isPub ? "PUBLISHED" : (status || "DRAFT");

    const discovery = await prisma.discovery.create({
      data: {
        title: title.trim(),
        slug,
        shortDescription: shortDescription?.trim() || null,
        content: content || null,
        discoveryType: discoveryType || "ANNOUNCEMENT",
        imageUrls: Array.isArray(imageUrls) ? imageUrls.filter((url: string) => typeof url === "string" && url.trim()) : [],
        youtubeUrl: youtubeUrl?.trim() || null,
        externalUrl: externalUrl?.trim() || null,
        tags: Array.isArray(tags) ? tags : [],
        status: finalStatus,
        publishAt: finalPublishAt,
        expireAt: expireAt ? new Date(expireAt) : null,
        isPublished: Boolean(isPub),
        isPinned: Boolean(isPinned),
        createdBy: accountId || null,
      },
    });

    if (isPub && (sendNotification !== false)) {
      notifyCustomersNewDiscovery(discovery);
    }

    return sendSuccessResponse(res, 201, "Discovery post created successfully", discovery);
  } catch (err: any) {
    console.error("Create discovery error:", err);
    return sendErrorResponse(res, 500, err.message || "Failed to create discovery post");
  }
}

/**
 * GET /api/v1/admin/discoveries
 */
export async function getAdminDiscoveries(req: Request, res: Response) {
  try {
    // Auto-promote any SCHEDULED posts whose publishAt date has arrived
    await prisma.discovery.updateMany({
      where: {
        status: "SCHEDULED",
        OR: [
          { publishAt: null },
          { publishAt: { lte: new Date() } },
        ],
      },
      data: {
        status: "PUBLISHED",
        isPublished: true,
      },
    }).catch(() => {});

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
    const skip = (page - 1) * limit;

    const { status, type, search } = req.query;

    const where: any = {};

    if (status && typeof status === "string") {
      where.status = status;
    }

    if (type && typeof type === "string") {
      where.discoveryType = type;
    }

    if (search && typeof search === "string" && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: "insensitive" } },
        { shortDescription: { contains: search.trim(), mode: "insensitive" } },
        { tags: { hasSome: [search.trim()] } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.discovery.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
        include: {
          createdByAcc: {
            select: { firstName: true, lastName: true, avatar: true },
          },
        },
      }),
      prisma.discovery.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Discoveries fetched", {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("Get admin discoveries error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch discoveries");
  }
}

/**
 * GET /api/v1/admin/discoveries/:id
 */
export async function getAdminDiscoveryById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const discovery = await prisma.discovery.findUnique({
      where: { id },
      include: {
        createdByAcc: {
          select: { firstName: true, lastName: true, avatar: true },
        },
        likes: {
          orderBy: { createdAt: "desc" },
          include: {
            customer: {
              select: { id: true, name: true, customerCompanyName: true, mobile: true, email: true },
            },
          },
        },
        comments: {
          orderBy: { createdAt: "desc" },
          include: {
            customer: {
              select: { id: true, name: true, customerCompanyName: true, mobile: true, email: true },
            },
          },
        },
      },
    });

    if (!discovery) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    return sendSuccessResponse(res, 200, "Discovery post details fetched", discovery);
  } catch (err: any) {
    console.error("Get discovery by id error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch discovery details");
  }
}

/**
 * PATCH /api/v1/admin/discoveries/:id
 */
export async function updateDiscovery(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;

    const existing = await prisma.discovery.findUnique({ where: { id } });
    if (!existing) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    const {
      title,
      shortDescription,
      content,
      discoveryType,
      imageUrls,
      youtubeUrl,
      externalUrl,
      tags,
      status,
      publishAt,
      expireAt,
      isPinned,
      sendNotification,
    } = req.body;

    let slug = existing.slug;
    if (title && title.trim() !== existing.title) {
      let baseSlug = slugify(title);
      slug = baseSlug;
      const taken = await prisma.discovery.findFirst({
        where: { slug, NOT: { id } },
      });
      if (taken) {
        slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
      }
    }

    const wasPublished = existing.isPublished;
    const targetStatus = status !== undefined ? status : existing.status;
    const targetPublishAt = publishAt !== undefined ? (publishAt ? new Date(publishAt) : null) : existing.publishAt;
    const isPub = targetStatus === "PUBLISHED" || (targetStatus === "SCHEDULED" && (!targetPublishAt || targetPublishAt <= new Date()));
    const finalStatus = isPub ? "PUBLISHED" : targetStatus;

    const updated = await prisma.discovery.update({
      where: { id },
      data: {
        ...(title ? { title: title.trim(), slug } : {}),
        ...(shortDescription !== undefined ? { shortDescription: shortDescription?.trim() || null } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(discoveryType ? { discoveryType } : {}),
        ...(Array.isArray(imageUrls) ? { imageUrls: imageUrls.filter((url: string) => typeof url === "string" && url.trim()) } : {}),
        ...(youtubeUrl !== undefined ? { youtubeUrl: youtubeUrl?.trim() || null } : {}),
        ...(externalUrl !== undefined ? { externalUrl: externalUrl?.trim() || null } : {}),
        ...(Array.isArray(tags) ? { tags } : {}),
        status: finalStatus,
        isPublished: isPub,
        ...(isPinned !== undefined ? { isPinned: Boolean(isPinned) } : {}),
        ...(publishAt !== undefined ? { publishAt: publishAt ? new Date(publishAt) : null } : {}),
        ...(expireAt !== undefined ? { expireAt: expireAt ? new Date(expireAt) : null } : {}),
        updatedBy: accountId || null,
      },
    });

    if (!wasPublished && isPub && (sendNotification !== false)) {
      notifyCustomersNewDiscovery(updated);
    }

    return sendSuccessResponse(res, 200, "Discovery post updated successfully", updated);
  } catch (err: any) {
    console.error("Update discovery error:", err);
    return sendErrorResponse(res, 500, err.message || "Failed to update discovery post");
  }
}

/**
 * DELETE /api/v1/admin/discoveries/:id
 */
export async function deleteDiscovery(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const existing = await prisma.discovery.findUnique({ where: { id } });
    if (!existing) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    await prisma.discovery.delete({ where: { id } });

    return sendSuccessResponse(res, 200, "Discovery post deleted successfully");
  } catch (err: any) {
    console.error("Delete discovery error:", err);
    return sendErrorResponse(res, 500, "Failed to delete discovery post");
  }
}

/**
 * POST /api/v1/admin/discoveries/:id/publish
 */
export async function publishDiscovery(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { sendNotification } = req.body;

    const existing = await prisma.discovery.findUnique({ where: { id } });
    if (!existing) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    const updated = await prisma.discovery.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        isPublished: true,
        publishAt: new Date(),
      },
    });

    if (sendNotification !== false) {
      notifyCustomersNewDiscovery(updated);
    }

    return sendSuccessResponse(res, 200, "Discovery post published successfully", updated);
  } catch (err: any) {
    console.error("Publish discovery error:", err);
    return sendErrorResponse(res, 500, "Failed to publish discovery post");
  }
}

/**
 * POST /api/v1/admin/discoveries/:id/archive
 */
export async function archiveDiscovery(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const existing = await prisma.discovery.findUnique({ where: { id } });
    if (!existing) {
      return sendErrorResponse(res, 404, "Discovery post not found");
    }

    const updated = await prisma.discovery.update({
      where: { id },
      data: {
        status: "ARCHIVED",
        isPublished: false,
      },
    });

    return sendSuccessResponse(res, 200, "Discovery post archived successfully", updated);
  } catch (err: any) {
    console.error("Archive discovery error:", err);
    return sendErrorResponse(res, 500, "Failed to archive discovery post");
  }
}
