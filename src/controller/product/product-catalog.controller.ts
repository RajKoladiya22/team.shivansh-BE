import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { Prisma, SyncStatus, ProductStatus } from "@prisma/client";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";

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

        const where: any = {};

        /* ─────────────────────────────────────
            Search
        ───────────────────────────────────── */
        function normalizeSearch(search?: string): string[] {
            if (!search || typeof search !== "string") {
                return [];
            }

            return search
                .toLowerCase()
                .replace(/[^\w\s]/g, " ")
                .split(/\s+/)
                .filter(Boolean);
        }

        const searchTerm = normalizeSearch(search as string);

        if (searchTerm) {
            where.AND = [
                ...(where.AND || []),
                ...searchTerm.map((word) => ({
                    title: {
                        contains: word,
                        mode: "insensitive",
                    },
                })),
            ];
        }

        /* ─────────────────────────────────────
           Status Filters
        ───────────────────────────────────── */

        if (status) {
            where.status = status as ProductStatus;
        }

        if (syncStatus) {
            where.syncStatus = syncStatus as SyncStatus;
        }

        /* ─────────────────────────────────────
           Boolean Filters
        ───────────────────────────────────── */

        if (isActive === "true") {
            where.isActive = true;
        }

        if (isActive === "false") {
            where.isActive = false;
        }

        if (isTopProduct === "true") {
            where.isTopProduct = true;
        }

        if (isTopProduct === "false") {
            where.isTopProduct = false;
        }

        if (isLatest === "true") {
            where.isLatest = true;
        }

        if (isLatest === "false") {
            where.isLatest = false;
        }

        /* ─────────────────────────────────────
           Category Filter
        ───────────────────────────────────── */

        const categorySlugs = String(
            categorySlug || ""
        )
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);

        if (categorySlugs.length > 0) {
            where.categorySlugs = {
                hasSome: categorySlugs,
            };
        }

        /* ─────────────────────────────────────
           Industry Filter
        ───────────────────────────────────── */

        const industrySlugs = String(
            industrySlug || ""
        )
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);

        if (industrySlugs.length > 0) {
            where.industrySlugs = {
                hasSome: industrySlugs,
            };
        }

        /* ─────────────────────────────────────
           Tag Filter
        ───────────────────────────────────── */

        const tagSlugs = String(tagSlug || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);

        if (tagSlugs.length > 0) {
            where.tagSlugs = {
                hasSome: tagSlugs,
            };
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
                orderBy: [
                    {
                        status: "asc",
                    },
                    {
                        [orderByField]: orderByDir,
                    },
                ],

                select: {
                    id: true,
                    adminProductId: true,
                    title: true,
                    slug: true,
                    subtitle: true,
                    shortDesc: true,
                    introVideoId: true,
                    detailedVideoId: true,
                    basePrice: true,
                    discountPercent: true,
                    discountAmount: true,
                    finalPrice: true,
                    trialAvailable: true,
                    status: true,
                    isTopProduct: true,
                    isLatest: true,
                    isActive: true,
                    categorySlugs: true,
                    industrySlugs: true,
                    tagSlugs: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.productCatalog.count({ where }),
        ]);



        return sendSuccessResponse(res, 200, "TDLs catalog list fetched", {
            data: products,
            meta: {
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

        return sendErrorResponse(res, 500, "Failed to fetch TDLs catalog list");
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
        
        return sendSuccessResponse(res, 200, "Details of TDL fetched", {
            data: product,
        });
    } catch (error) {
        console.error("[ProductCatalog] getProductCatalogById error", error);
         return sendErrorResponse(res, 500, "Failed to fetch TDL details");
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