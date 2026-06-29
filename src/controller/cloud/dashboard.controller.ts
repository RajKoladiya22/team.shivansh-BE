import { Request, Response } from "express";
import { CloudServiceType, Prisma } from "@prisma/client";
import { prisma } from "../../config/database.config";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";

// =============================================================================
// GET /cloud-services/stats/dashboard
// =============================================================================
// Comprehensive dashboard statistics including:
// - Total count of all cloud services
// - Count by type (MIRACLE, COMHARD)
// - Count by status (active/inactive)
// - Count by trial status (on trial, completed trials, never tried)
// - Count by renewal type (QUARTERLY, SIX_MONTHS, YEARLY)
// - Count by drive setup status
// - Services expiring in N days
// - Count by renewal type (with breakdown by type)
// =============================================================================

interface DashboardStatsQuery {
    expiringInDays?: string; // default: 7 days
}

interface TrialStats {
    onTrial: number;
    trialCompleted: number;
    neverTrialed: number;
    trialsCompleted: number;
    trialsConverted: number;
    trialConversionRate: number;
}

interface RenewalTypeStats {
    QUARTERLY: number;
    SIX_MONTHS: number;
    YEARLY: number;
}

interface ExpiringServicesStats {
    withInDays: number;
    daysSelected: number;
}

interface DriveSetupStats {
    setupComplete: number;
    notSetup: number;
}

interface TypeBreakdown {
    type: CloudServiceType;
    count: number;
    active: number;
    inactive: number;
    onTrial: number;
    setupComplete: number;
}

interface DashboardStats {
    // Overall counts
    totalServices: number;
    totalActive: number;
    totalInactive: number;
    totalExpired: number;
    expiredServicesList: any[];
    expiringSoonServicesList: any[];

    // By type
    byType: TypeBreakdown[];
    miracle: {
        total: number;
        active: number;
        inactive: number;
        setupComplete: number;
        notSetup: number;
    };
    comhard: {
        total: number;
        active: number;
        inactive: number;
        trial: TrialStats;
        setupComplete: number;
        notSetup: number;
    };

    // Renewal type breakdown
    byRenewalType: RenewalTypeStats;

    // Expiring services
    expiringServices: ExpiringServicesStats;

    // Drive setup
    driveSetup: DriveSetupStats;

    // Additional metrics
    metrics: {
        averageServiceCost: number | null;
        totalServiceCost: number | null;
        servicesWithoutCost: number;
    };

    // Summary
    summary: {
        totalUsers: number;
        activeUsers: number;
    };
}

export async function getCloudServiceDashboardStats(
    req: Request,
    res: Response,
) {
    try {
        if (!req.user?.id) {
            return sendErrorResponse(res, 401, "Unauthorized");
        }

        const { expiringInDays = "7" } = req.query as DashboardStatsQuery;

        const daysThreshold = Math.max(Number(expiringInDays) || 7, 1);

        // ─────────────────────────────────────────────────────────────────────────
        // 1. Overall counts
        // ─────────────────────────────────────────────────────────────────────────

        const [totalServices, totalActive, totalInactive, totalExpired] = await Promise.all([
            prisma.cloudService.count(),
            prisma.cloudService.count({
                where: { isActive: true },
            }),
            prisma.cloudService.count({
                where: { isActive: false },
            }),
            prisma.cloudService.count({
                where: {
                    billingDate: {
                        lt: new Date(),
                    },
                },
            }),
        ]);

        // ─────────────────────────────────────────────────────────────────────────
        // 2. By type (MIRACLE / COMHARD)
        // ─────────────────────────────────────────────────────────────────────────

        const byTypeRaw = await prisma.cloudService.groupBy({
            by: ["type"],
            _count: {
                id: true,
            },
            where: {},
        });

        const typeBreakdown: TypeBreakdown[] = [];

        // Process each type
        for (const typeGroup of byTypeRaw) {
            const [
                typeCount,
                typeActive,
                typeInactive,
                typeOnTrial,
                typeSetupComplete,
            ] = await Promise.all([
                prisma.cloudService.count({
                    where: { type: typeGroup.type },
                }),
                prisma.cloudService.count({
                    where: { type: typeGroup.type, isActive: true },
                }),
                prisma.cloudService.count({
                    where: { type: typeGroup.type, isActive: false },
                }),
                prisma.cloudService.count({
                    where: {
                        type: typeGroup.type,
                        ...(typeGroup.type === "COMHARD" && {
                            isOnTrial: true,
                        }),
                    },
                }),
                prisma.cloudService.count({
                    where: { type: typeGroup.type, isDriveSetup: true },
                }),
            ]);

            typeBreakdown.push({
                type: typeGroup.type,
                count: typeCount,
                active: typeActive,
                inactive: typeInactive,
                onTrial: typeOnTrial,
                setupComplete: typeSetupComplete,
            });
        }

        // Get Miracle stats
        const [
            miracleTotal,
            miracleActive,
            miracleInactive,
            miracleSetupComplete,
        ] = await Promise.all([
            prisma.cloudService.count({
                where: { type: "MIRACLE" },
            }),
            prisma.cloudService.count({
                where: { type: "MIRACLE", isActive: true },
            }),
            prisma.cloudService.count({
                where: { type: "MIRACLE", isActive: false },
            }),
            prisma.cloudService.count({
                where: { type: "MIRACLE", isDriveSetup: true },
            }),
        ]);

        // Get Comhard stats
        const [
            comhardTotal,
            comhardActive,
            comhardInactive,
            comhardOnTrial,
            comhardSetupComplete,
        ] = await Promise.all([
            prisma.cloudService.count({
                where: { type: "COMHARD" },
            }),
            prisma.cloudService.count({
                where: { type: "COMHARD", isActive: true },
            }),
            prisma.cloudService.count({
                where: { type: "COMHARD", isActive: false },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    isOnTrial: true,
                },
            }),
            prisma.cloudService.count({
                where: { type: "COMHARD", isDriveSetup: true },
            }),
        ]);

        const [
            comhardTrialCompleted,
            comhardNeverTrial,
            comhardTrialsCompleted,
            comhardTrialsConverted,
        ] = await Promise.all([
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    isOnTrial: false,
                    trialDoneAt: { not: null },
                },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    trialStartDate: null,
                },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    trialDoneAt: { not: null },
                },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    trialDoneAt: { not: null },
                    isActive: true,
                },
            }),
        ]);

        const comhardTrialConversionRate = comhardTrialsCompleted > 0
            ? Math.round((comhardTrialsConverted / comhardTrialsCompleted) * 1000) / 10
            : 0;

        // ─────────────────────────────────────────────────────────────────────────
        // 3. By renewal type (QUARTERLY, SIX_MONTHS, YEARLY)
        // ─────────────────────────────────────────────────────────────────────────

        const [quarterly, sixMonths, yearly] = await Promise.all([
            prisma.cloudService.count({
                where: { renewalType: "QUARTERLY" },
            }),
            prisma.cloudService.count({
                where: { renewalType: "SIX_MONTHS" },
            }),
            prisma.cloudService.count({
                where: { renewalType: "YEARLY" },
            }),
        ]);

        // ─────────────────────────────────────────────────────────────────────────
        // 4. Expiring services (within N days from now)
        // ─────────────────────────────────────────────────────────────────────────

        const now = new Date();
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysThreshold);

        const expiringCount = await prisma.cloudService.count({
            where: {
                billingDate: {
                    gte: now,
                    lte: futureDate,
                },
            },
        });

        // ── Get expired and expiring soon lists ──────────────────────────────────
        const [expiredServicesList, expiringSoonServicesList] = await Promise.all([
            prisma.cloudService.findMany({
                where: {
                    billingDate: {
                        lt: now,
                    },
                },
                take: 5,
                orderBy: {
                    billingDate: "desc",
                },
                include: {
                    customer: {
                        select: {
                            name: true,
                            customerCompanyName: true,
                        },
                    },
                },
            }),
            prisma.cloudService.findMany({
                where: {
                    billingDate: {
                        gte: now,
                        lte: futureDate,
                    },
                },
                take: 5,
                orderBy: {
                    billingDate: "asc",
                },
                include: {
                    customer: {
                        select: {
                            name: true,
                            customerCompanyName: true,
                        },
                    },
                },
            }),
        ]);

        // ─────────────────────────────────────────────────────────────────────────
        // 5. Drive setup status
        // ─────────────────────────────────────────────────────────────────────────

        const [setupComplete, notSetup] = await Promise.all([
            prisma.cloudService.count({
                where: { isDriveSetup: true },
            }),
            prisma.cloudService.count({
                where: { isDriveSetup: false },
            }),
        ]);

        // ─────────────────────────────────────────────────────────────────────────
        // 6. Cost metrics
        // ─────────────────────────────────────────────────────────────────────────

        const costMetrics = await prisma.cloudService.aggregate({
            _avg: {
                cost: true,
            },
            _sum: {
                cost: true,
            },
        });

        const servicesWithoutCost = await prisma.cloudService.count({
            where: {
                cost: null,
            },
        });

        // ─────────────────────────────────────────────────────────────────────────
        // 7. User summary
        // ─────────────────────────────────────────────────────────────────────────

        const [totalUsers, activeUsers] = await Promise.all([
            prisma.cloudServiceUser.count(),
            prisma.cloudServiceUser.count({
                where: { isActive: true },
            }),
        ]);

        // ─────────────────────────────────────────────────────────────────────────
        // Construct response
        // ─────────────────────────────────────────────────────────────────────────

        const stats: DashboardStats = {
            // Overall counts
            totalServices,
            totalActive,
            totalInactive,
            totalExpired,
            expiredServicesList,
            expiringSoonServicesList,

            // By type
            byType: typeBreakdown,
            miracle: {
                total: miracleTotal,
                active: miracleActive,
                inactive: miracleInactive,
                setupComplete: miracleSetupComplete,
                notSetup: miracleTotal - miracleSetupComplete,
            },
            comhard: {
                total: comhardTotal,
                active: comhardActive,
                inactive: comhardInactive,
                trial: {
                    onTrial: comhardOnTrial,
                    trialCompleted: comhardTrialCompleted,
                    neverTrialed: comhardNeverTrial,
                    trialsCompleted: comhardTrialsCompleted,
                    trialsConverted: comhardTrialsConverted,
                    trialConversionRate: comhardTrialConversionRate,
                },
                setupComplete: comhardSetupComplete,
                notSetup: comhardTotal - comhardSetupComplete,
            },

            // Renewal type
            byRenewalType: {
                QUARTERLY: quarterly,
                SIX_MONTHS: sixMonths,
                YEARLY: yearly,
            },

            // Expiring
            expiringServices: {
                withInDays: expiringCount,
                daysSelected: daysThreshold,
            },

            // Drive setup
            driveSetup: {
                setupComplete,
                notSetup,
            },

            // Metrics
            metrics: {
                averageServiceCost: costMetrics._avg.cost
                    ? Number(costMetrics._avg.cost)
                    : null,
                totalServiceCost: costMetrics._sum.cost
                    ? Number(costMetrics._sum.cost)
                    : null,
                servicesWithoutCost,
            },

            // Summary
            summary: {
                totalUsers,
                activeUsers,
            },
        };

        return sendSuccessResponse(
            res,
            200,
            "Dashboard stats retrieved successfully",
            stats,
        );
    } catch (err: any) {
        console.error("getCloudServiceDashboardStats error:", err);
        return sendErrorResponse(
            res,
            500,
            err?.message ?? "Failed to fetch dashboard stats",
        );
    }
}

// =============================================================================
// GET /cloud-services/stats/detailed
// More detailed breakdown with additional filters
// =============================================================================

interface DetailedStatsQuery {
    type?: "MIRACLE" | "COMHARD";
    isActive?: "true" | "false";
    expiringInDays?: string;
}

interface DetailedStats extends DashboardStats {
    filters: {
        type?: CloudServiceType;
        isActive?: boolean;
        expiringInDays?: number;
    };
    filtered: {
        count: number;
        active: number;
        inactive: number;
    };
}

export async function getCloudServiceDetailedStats(
    req: Request,
    res: Response,
) {
    try {
        if (!req.user?.id) {
            return sendErrorResponse(res, 401, "Unauthorized");
        }

        const { type, isActive, expiringInDays = "7" } =
            req.query as DetailedStatsQuery;

        const daysThreshold = Math.max(Number(expiringInDays) || 7, 1);

        // Build filter conditions
        const whereConditions: Prisma.CloudServiceWhereInput[] = [];

        if (type) {
            whereConditions.push({ type: type as CloudServiceType });
        }

        if (isActive !== undefined) {
            whereConditions.push({ isActive: isActive === "true" });
        }

        const baseWhere: Prisma.CloudServiceWhereInput =
            whereConditions.length > 0 ? { AND: whereConditions } : {};

        // ─────────────────────────────────────────────────────────────────────────
        // Get overall stats first (unfiltered)
        // ─────────────────────────────────────────────────────────────────────────

        const [totalServices, totalActive, totalInactive, totalExpired] = await Promise.all([
            prisma.cloudService.count(),
            prisma.cloudService.count({ where: { isActive: true } }),
            prisma.cloudService.count({ where: { isActive: false } }),
            prisma.cloudService.count({
                where: {
                    expiryDate: {
                        lt: new Date(),
                    },
                },
            }),
        ]);

        // ─────────────────────────────────────────────────────────────────────────
        // Get all other stats (unfiltered)
        // ─────────────────────────────────────────────────────────────────────────

        const byTypeRaw = await prisma.cloudService.groupBy({
            by: ["type"],
            _count: { id: true },
        });

        const typeBreakdown: TypeBreakdown[] = [];

        for (const typeGroup of byTypeRaw) {
            const [typeCount, typeActive, typeInactive, typeOnTrial, typeSetupComplete] =
                await Promise.all([
                    prisma.cloudService.count({
                        where: { type: typeGroup.type },
                    }),
                    prisma.cloudService.count({
                        where: { type: typeGroup.type, isActive: true },
                    }),
                    prisma.cloudService.count({
                        where: { type: typeGroup.type, isActive: false },
                    }),
                    prisma.cloudService.count({
                        where: {
                            type: typeGroup.type,
                            ...(typeGroup.type === "COMHARD" && {
                                isOnTrial: true,
                            }),
                        },
                    }),
                    prisma.cloudService.count({
                        where: { type: typeGroup.type, isDriveSetup: true },
                    }),
                ]);

            typeBreakdown.push({
                type: typeGroup.type,
                count: typeCount,
                active: typeActive,
                inactive: typeInactive,
                onTrial: typeOnTrial,
                setupComplete: typeSetupComplete,
            });
        }

        const [
            miracleTotal,
            miracleActive,
            miracleInactive,
            miracleSetupComplete,
        ] = await Promise.all([
            prisma.cloudService.count({
                where: { type: "MIRACLE" },
            }),
            prisma.cloudService.count({
                where: { type: "MIRACLE", isActive: true },
            }),
            prisma.cloudService.count({
                where: { type: "MIRACLE", isActive: false },
            }),
            prisma.cloudService.count({
                where: { type: "MIRACLE", isDriveSetup: true },
            }),
        ]);

        // Get Comhard stats
        const [
            comhardTotal,
            comhardActive,
            comhardInactive,
            comhardOnTrial,
            comhardSetupComplete,
        ] = await Promise.all([
            prisma.cloudService.count({
                where: { type: "COMHARD" },
            }),
            prisma.cloudService.count({
                where: { type: "COMHARD", isActive: true },
            }),
            prisma.cloudService.count({
                where: { type: "COMHARD", isActive: false },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    isOnTrial: true,
                },
            }),
            prisma.cloudService.count({
                where: { type: "COMHARD", isDriveSetup: true },
            }),
        ]);

        const [
            comhardTrialCompleted,
            comhardNeverTrial,
            comhardTrialsCompleted,
            comhardTrialsConverted,
        ] = await Promise.all([
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    isOnTrial: false,
                    trialDoneAt: { not: null },
                },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    trialStartDate: null,
                },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    trialDoneAt: { not: null },
                },
            }),
            prisma.cloudService.count({
                where: {
                    type: "COMHARD",
                    trialDoneAt: { not: null },
                    isActive: true,
                },
            }),
        ]);

        const comhardTrialConversionRate = comhardTrialsCompleted > 0
            ? Math.round((comhardTrialsConverted / comhardTrialsCompleted) * 1000) / 10
            : 0;

        const [quarterly, sixMonths, yearly] = await Promise.all([
            prisma.cloudService.count({
                where: { renewalType: "QUARTERLY" },
            }),
            prisma.cloudService.count({
                where: { renewalType: "SIX_MONTHS" },
            }),
            prisma.cloudService.count({
                where: { renewalType: "YEARLY" },
            }),
        ]);

        const now = new Date();
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysThreshold);

        const expiringCount = await prisma.cloudService.count({
            where: {
                billingDate: {
                    gte: now,
                    lte: futureDate,
                },
            },
        });

        // ── Get expired and expiring soon lists ──────────────────────────────────
        const [expiredServicesList, expiringSoonServicesList] = await Promise.all([
            prisma.cloudService.findMany({
                where: {
                    billingDate: {
                        lt: now,
                    },
                },
                take: 5,
                orderBy: {
                    billingDate: "desc",
                },
                include: {
                    customer: {
                        select: {
                            name: true,
                            customerCompanyName: true,
                        },
                    },
                },
            }),
            prisma.cloudService.findMany({
                where: {
                    billingDate: {
                        gte: now,
                        lte: futureDate,
                    },
                },
                take: 5,
                orderBy: {
                    billingDate: "asc",
                },
                include: {
                    customer: {
                        select: {
                            name: true,
                            customerCompanyName: true,
                        },
                    },
                },
            }),
        ]);

        const [setupComplete, notSetup] = await Promise.all([
            prisma.cloudService.count({
                where: { isDriveSetup: true },
            }),
            prisma.cloudService.count({
                where: { isDriveSetup: false },
            }),
        ]);

        const costMetrics = await prisma.cloudService.aggregate({
            _avg: { cost: true },
            _sum: { cost: true },
        });

        const servicesWithoutCost = await prisma.cloudService.count({
            where: { cost: null },
        });

        const [totalUsers, activeUsers] = await Promise.all([
            prisma.cloudServiceUser.count(),
            prisma.cloudServiceUser.count({
                where: { isActive: true },
            }),
        ]);

        // ─────────────────────────────────────────────────────────────────────────
        // Get filtered counts
        // ─────────────────────────────────────────────────────────────────────────

        const [filteredCount, filteredActive, filteredInactive] =
            await Promise.all([
                prisma.cloudService.count({ where: baseWhere }),
                prisma.cloudService.count({
                    where: { ...baseWhere, isActive: true },
                }),
                prisma.cloudService.count({
                    where: { ...baseWhere, isActive: false },
                }),
            ]);

        const dashboardStats: DashboardStats = {
            totalServices,
            totalActive,
            totalInactive,
            totalExpired,
            expiredServicesList,
            expiringSoonServicesList,
            byType: typeBreakdown,
            miracle: {
                total: miracleTotal,
                active: miracleActive,
                inactive: miracleInactive,
                setupComplete: miracleSetupComplete,
                notSetup: miracleTotal - miracleSetupComplete,
            },
            comhard: {
                total: comhardTotal,
                active: comhardActive,
                inactive: comhardInactive,
                trial: {
                    onTrial: comhardOnTrial,
                    trialCompleted: comhardTrialCompleted,
                    neverTrialed: comhardNeverTrial,
                    trialsCompleted: comhardTrialsCompleted,
                    trialsConverted: comhardTrialsConverted,
                    trialConversionRate: comhardTrialConversionRate,
                },
                setupComplete: comhardSetupComplete,
                notSetup: comhardTotal - comhardSetupComplete,
            },
            byRenewalType: {
                QUARTERLY: quarterly,
                SIX_MONTHS: sixMonths,
                YEARLY: yearly,
            },
            expiringServices: {
                withInDays: expiringCount,
                daysSelected: daysThreshold,
            },
            driveSetup: {
                setupComplete,
                notSetup,
            },
            metrics: {
                averageServiceCost: costMetrics._avg.cost
                    ? Number(costMetrics._avg.cost)
                    : null,
                totalServiceCost: costMetrics._sum.cost
                    ? Number(costMetrics._sum.cost)
                    : null,
                servicesWithoutCost,
            },
            summary: {
                totalUsers,
                activeUsers,
            },
        };

        const detailedStats: DetailedStats = {
            ...dashboardStats,
            filters: {
                type: type as CloudServiceType | undefined,
                isActive: isActive ? isActive === "true" : undefined,
                expiringInDays: daysThreshold,
            },
            filtered: {
                count: filteredCount,
                active: filteredActive,
                inactive: filteredInactive,
            },
        };

        return sendSuccessResponse(
            res,
            200,
            "Detailed stats retrieved successfully",
            detailedStats,
        );
    } catch (err: any) {
        console.error("getCloudServiceDetailedStats error:", err);
        return sendErrorResponse(
            res,
            500,
            err?.message ?? "Failed to fetch detailed stats",
        );
    }
}

// =============================================================================
// GET /cloud-services/stats/quick
// Quick summary stats (cached-friendly response for dashboards)
// =============================================================================

interface QuickStats {
    total: number;
    active: number;
    inactive: number;
    byType: {
        MIRACLE: number;
        COMHARD: number;
    };
    expiringIn7Days: number;
    onTrial: number;
    needsSetup: number;
    expired: number;
}

export async function getQuickCloudServiceStats(
    req: Request,
    res: Response,
) {
    try {
        if (!req.user?.id) {
            return sendErrorResponse(res, 401, "Unauthorized");
        }

        const now = new Date();
        const sevenDaysLater = new Date();
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const [
            total,
            active,
            inactive,
            miracle,
            comhard,
            expiring,
            onTrial,
            needsSetup,
            expired,
        ] = await Promise.all([
            prisma.cloudService.count(),
            prisma.cloudService.count({ where: { isActive: true } }),
            prisma.cloudService.count({ where: { isActive: false } }),
            prisma.cloudService.count({ where: { type: "MIRACLE" } }),
            prisma.cloudService.count({ where: { type: "COMHARD" } }),
            prisma.cloudService.count({
                where: {
                    expiryDate: {
                        gte: now,
                        lte: sevenDaysLater,
                    },
                },
            }),
            prisma.cloudService.count({
                where: { type: "COMHARD", isOnTrial: true },
            }),
            prisma.cloudService.count({
                where: { isDriveSetup: false },
            }),
            prisma.cloudService.count({
                where: {
                    expiryDate: {
                        lt: now,
                    },
                },
            }),
        ]);

        const stats: QuickStats = {
            total,
            active,
            inactive,
            byType: {
                MIRACLE: miracle,
                COMHARD: comhard,
            },
            expiringIn7Days: expiring,
            onTrial,
            needsSetup,
            expired,
        };

        return sendSuccessResponse(
            res,
            200,
            "Quick stats retrieved successfully",
            stats,
        );
    } catch (err: any) {
        console.error("getQuickCloudServiceStats error:", err);
        return sendErrorResponse(
            res,
            500,
            err?.message ?? "Failed to fetch quick stats",
        );
    }
}