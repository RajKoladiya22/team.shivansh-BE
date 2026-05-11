import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { Prisma, SyncStatus, ProductStatus } from "@prisma/client";

// ─────────────────────────────────────
// GET /product-catalog
// ─────────────────────────────────────

export async function getProductCatalogList(req: Request, res: Response) {
    try {
        const {
            page = "1",
            limit = "20",
            search,
            status,
            syncStatus,
            isActive,
            isTopProduct,
            isLatest,
            categorySlug,
            industrySlug,
            tagSlug,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query;

        const pageNum = Math.max(1, parseInt(page as string));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
        const skip = (pageNum - 1) * limitNum;

        const where: Prisma.ProductCatalogWhereInput = {};

        if (search) {
            where.OR = [
                { title: { contains: search as string, mode: "insensitive" } },
                { slug: { contains: search as string, mode: "insensitive" } },
                { subtitle: { contains: search as string, mode: "insensitive" } },
                { shortDesc: { contains: search as string, mode: "insensitive" } },
            ];
        }

        if (status) {
            where.status = status as ProductStatus;
        }

        if (syncStatus) {
            where.syncStatus = syncStatus as SyncStatus;
        }

        if (isActive !== undefined) {
            where.isActive = isActive === "true";
        }

        if (isTopProduct !== undefined) {
            where.isTopProduct = isTopProduct === "true";
        }

        if (isLatest !== undefined) {
            where.isLatest = isLatest === "true";
        }

        if (categorySlug) {
            where.categorySlugs = { has: categorySlug as string };
        }

        if (industrySlug) {
            where.industrySlugs = { has: industrySlug as string };
        }

        if (tagSlug) {
            where.tagSlugs = { has: tagSlug as string };
        }

        const allowedSortFields = [
            "createdAt",
            "updatedAt",
            "syncedAt",
            "title",
            "finalPrice",
            "salesPriority",
            "syncVersion",
        ];

        const orderByField = allowedSortFields.includes(sortBy as string)
            ? (sortBy as string)
            : "createdAt";

        const orderByDir = sortOrder === "asc" ? "asc" : "desc";

        const [products, total] = await Promise.all([
            prisma.productCatalog.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { [orderByField]: orderByDir },
                select: {
                    id: true,
                    adminProductId: true,
                    title: true,
                    slug: true,
                    subtitle: true,
                    shortDesc: true,
                    pricingModel: true,
                    basePrice: true,
                    discountPercent: true,
                    discountAmount: true,
                    finalPrice: true,
                    trialAvailable: true,
                    status: true,
                    isTopProduct: true,
                    isLatest: true,
                    isActive: true,
                    salesPriority: true,
                    categorySlugs: true,
                    industrySlugs: true,
                    tagSlugs: true,
                    syncStatus: true,
                    syncedAt: true,
                    syncVersion: true,
                    lastSyncAttempt: true,
                    syncError: true,
                    sourceUpdatedAt: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.productCatalog.count({ where }),
        ]);

        return res.json({
            success: true,
            data: products,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNext: pageNum * limitNum < total,
                hasPrev: pageNum > 1,
            },
        });
    } catch (error) {
        console.error("[ProductCatalog] getProductCatalogList error", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch product catalog list",
        });
    }
}

// ─────────────────────────────────────
// GET /product-catalog/:id
// ─────────────────────────────────────

export async function getProductCatalogById(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const product = await prisma.productCatalog.findUnique({
            where: { id },
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        return res.json({
            success: true,
            data: product,
        });
    } catch (error) {
        console.error("[ProductCatalog] getProductCatalogById error", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch product",
        });
    }
}

// ─────────────────────────────────────
// GET /product-catalog/sync-logs
// ─────────────────────────────────────

export async function getProductCatalogSyncLogs(req: Request, res: Response) {
    try {
        const {
            page = "1",
            limit = "20",
            adminProductId,
            productCatalogId,
            syncStatus,
            action,
            from,
            to,
            sortOrder = "desc",
        } = req.query;

        const pageNum = Math.max(1, parseInt(page as string));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
        const skip = (pageNum - 1) * limitNum;

        const where: Prisma.ProductCatalogSyncLogWhereInput = {};

        if (adminProductId) {
            where.adminProductId = adminProductId as string;
        }

        if (productCatalogId) {
            where.productCatalogId = productCatalogId as string;
        }

        if (syncStatus) {
            where.syncStatus = syncStatus as SyncStatus;
        }

        if (action) {
            where.action = action as string;
        }

        if (from || to) {
            where.createdAt = {
                ...(from && { gte: new Date(from as string) }),
                ...(to && { lte: new Date(to as string) }),
            };
        }

        const orderByDir = sortOrder === "asc" ? "asc" : "desc";

        const [logs, total] = await Promise.all([
            prisma.productCatalogSyncLog.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { createdAt: orderByDir },
            }),
            prisma.productCatalogSyncLog.count({ where }),
        ]);

        return res.json({
            success: true,
            data: logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNext: pageNum * limitNum < total,
                hasPrev: pageNum > 1,
            },
        });
    } catch (error) {
        console.error("[ProductCatalog] getProductCatalogSyncLogs error", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch sync logs",
        });
    }
}

// ─────────────────────────────────────
// GET /product-catalog/:id/sync-logs
// ─────────────────────────────────────

export async function getProductSyncLogs(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const {
            page = "1",
            limit = "20",
            syncStatus,
            action,
            sortOrder = "desc",
        } = req.query;

        const pageNum = Math.max(1, parseInt(page as string));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
        const skip = (pageNum - 1) * limitNum;

        // Verify product exists
        const product = await prisma.productCatalog.findUnique({
            where: { id },
            select: {
                id: true,
                adminProductId: true,
                title: true,
                syncStatus: true,
                syncedAt: true,
                syncVersion: true,
                lastSyncAttempt: true,
                syncError: true,
            },
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        const where: Prisma.ProductCatalogSyncLogWhereInput = {
            productCatalogId: id,
        };

        if (syncStatus) {
            where.syncStatus = syncStatus as SyncStatus;
        }

        if (action) {
            where.action = action as string;
        }

        const orderByDir = sortOrder === "asc" ? "asc" : "desc";

        const [logs, total] = await Promise.all([
            prisma.productCatalogSyncLog.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { createdAt: orderByDir },
            }),
            prisma.productCatalogSyncLog.count({ where }),
        ]);

        return res.json({
            success: true,
            data: {
                product,
                logs,
            },
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNext: pageNum * limitNum < total,
                hasPrev: pageNum > 1,
            },
        });
    } catch (error) {
        console.error("[ProductCatalog] getProductSyncLogs error", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch product sync logs",
        });
    }
}