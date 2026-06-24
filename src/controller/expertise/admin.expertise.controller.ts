import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { Prisma, ExpertiseLevel } from "@prisma/client";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";

// ─────────────────────────────────────
// ADMIN: GET ALL EMPLOYEES WITH EXPERTISE SUMMARY
// GET /expertise/tdl/admin/employees
//
// Query params:
//   search        string   — filter by employee name or email
//   expertiseLevel ExpertiseLevel — filter employees who have at least one entry at this level
//   minProducts   number   — filter employees with >= N products marked
//   sortBy        "totalProducts" | "expertCount" | "canDemoCount" | "leadsConverted" | "avgSuccessRate" | "name"
//   sortOrder     "asc" | "desc"
//   page          number
//   limit         number
// ─────────────────────────────────────

export async function adminGetEmployeeExpertiseList(
    req: Request,
    res: Response
) {
    try {
        const {
            search,
            expertiseLevel,
            minProducts,
            sortBy = "totalProducts",
            sortOrder = "desc",
            page = "1",
            limit = "20",
        } = req.query;

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        // ── Build the where clause for accounts that HAVE expertise records ──
        const expertiseWhere: Prisma.UserProductExpertiseWhereInput = {};

        if (expertiseLevel) {
            expertiseWhere.expertiseLevel = expertiseLevel as ExpertiseLevel;
        }

        // ── Build account where clause ──
        const accountWhere: Prisma.AccountWhereInput = {};

        if (search) {
            const s = search as string;
            accountWhere.OR = [
                { firstName: { contains: s, mode: "insensitive" } },
                { lastName: { contains: s, mode: "insensitive" } },
                { contactEmail: { contains: s, mode: "insensitive" } },
            ];
        }

        // Only include accounts that have at least one expertise record
        // (optionally filtered by level)
        accountWhere.productExpertise = {
            some: expertiseWhere,
        };

        // ── Fetch all matching accounts with their expertise ──
        const accounts = await prisma.account.findMany({
            where: accountWhere,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                contactEmail: true,
                avatar: true,
                designation: true,
                productExpertise: {
                    where: expertiseWhere,
                    select: {
                        id: true,
                        expertiseLevel: true,
                        leadsConverted: true,
                        successRate: true,
                        demoCount: true,
                        completedProjects: true,
                        yearsOfExperience: true,
                        lastDemoAt: true,
                        lastUpdatedAt: true,
                        productCatalog: {
                            select: {
                                id: true,
                                title: true,
                                slug: true,
                                finalPrice: true,
                                categorySlugs: true,
                            },
                        },
                    },
                },
            },
        });

        // ── Compute per-employee summary ──
        type EmployeeSummary = {
            id: string;
            firstName: string;
            lastName: string;
            contactEmail: string | null;
            avatar: string | null;
            designation: string | null;
            totalProducts: number;
            expertCount: number;
            canDemoCount: number;
            learningCount: number;
            guidanceCount: number;
            noneCount: number;
            totalLeadsConverted: number;
            totalDemos: number;
            totalCompletedProjects: number;
            avgSuccessRate: number;
            lastActivityAt: Date | null;
        };

        let summaries: EmployeeSummary[] = accounts.map((acc) => {
            const ep = acc.productExpertise;

            const expertCount = ep.filter((e) => e.expertiseLevel === "EXPERT").length;
            const canDemoCount = ep.filter((e) => e.expertiseLevel === "CAN_DEMO").length;
            const learningCount = ep.filter((e) => e.expertiseLevel === "LEARNING").length;
            const guidanceCount = ep.filter((e) => e.expertiseLevel === "GUIDANCE_NEEDED").length;
            const noneCount = ep.filter((e) => e.expertiseLevel === "NONE").length;
            const totalLeadsConverted = ep.reduce((s, e) => s + e.leadsConverted, 0);
            const totalDemos = ep.reduce((s, e) => s + e.demoCount, 0);
            const totalCompletedProjects = ep.reduce((s, e) => s + e.completedProjects, 0);
            const avgSuccessRate =
                ep.length > 0
                    ? ep.reduce((s, e) => s + e.successRate, 0) / ep.length
                    : 0;

            // Most recent activity across all their expertise entries
            const lastActivityAt = ep.reduce<Date | null>((latest, e) => {
                const d = e.lastDemoAt ?? e.lastUpdatedAt;
                if (!d) return latest;
                const dt = new Date(d);
                return !latest || dt > latest ? dt : latest;
            }, null);

            return {
                id: acc.id,
                firstName: acc.firstName,
                lastName: acc.lastName,
                contactEmail: acc.contactEmail ?? null,
                avatar: acc.avatar ?? null,
                designation: acc.designation ?? null,
                totalProducts: ep.length,
                expertCount,
                canDemoCount,
                learningCount,
                guidanceCount,
                noneCount,
                totalLeadsConverted,
                totalDemos,
                totalCompletedProjects,
                avgSuccessRate,
                lastActivityAt,
            };
        });

        // ── Apply minProducts filter (post-aggregation) ──
        if (minProducts) {
            const min = parseInt(minProducts as string, 10);
            if (!isNaN(min)) {
                summaries = summaries.filter((s) => s.totalProducts >= min);
            }
        }

        // ── Sort ──
        const dir = sortOrder === "asc" ? 1 : -1;

        summaries.sort((a, b) => {
            switch (sortBy as string) {
                case "name":
                    return dir * `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
                case "expertCount":
                    return dir * (a.expertCount - b.expertCount);
                case "canDemoCount":
                    return dir * (a.canDemoCount - b.canDemoCount);
                case "leadsConverted":
                    return dir * (a.totalLeadsConverted - b.totalLeadsConverted);
                case "avgSuccessRate":
                    return dir * (a.avgSuccessRate - b.avgSuccessRate);
                case "totalProducts":
                default:
                    return dir * (a.totalProducts - b.totalProducts);
            }
        });

        // ── Paginate (in-memory, since we need aggregated fields for sorting/filtering) ──
        const total = summaries.length;
        const paginated = summaries.slice(skip, skip + limitNum);

        // ── Overall team stats ──
        const teamStats = {
            totalEmployeesWithExpertise: total,
            totalExpertEntries: accounts.reduce(
                (s, a) => s + a.productExpertise.filter((e) => e.expertiseLevel === "EXPERT").length,
                0
            ),
            totalCanDemoEntries: accounts.reduce(
                (s, a) => s + a.productExpertise.filter((e) => e.expertiseLevel === "CAN_DEMO").length,
                0
            ),
            totalLearningEntries: accounts.reduce(
                (s, a) => s + a.productExpertise.filter((e) => e.expertiseLevel === "LEARNING").length,
                0
            ),
            totalLeadsConverted: accounts.reduce(
                (s, a) => s + a.productExpertise.reduce((x, e) => x + e.leadsConverted, 0),
                0
            ),
        };

        return sendSuccessResponse(
            res,
            200,
            "Employee expertise list fetched",
            paginated,
            {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNext: skip + limitNum < total,
                hasPrev: pageNum > 1,
                teamStats,
            }
        );
    } catch (error) {
        console.error("[AdminExpertise] adminGetEmployeeExpertiseList error", error);
        return sendErrorResponse(res, 500, "Failed to fetch employee expertise list");
    }
}

// ─────────────────────────────────────
// ADMIN: GET ONE EMPLOYEE'S FULL EXPERTISE DETAIL
// GET /expertise/tdl/admin/employees/:employeeId
//
// Returns every product the employee has marked, with full stats,
// skills, certifications, notes, and activity timestamps.
// ─────────────────────────────────────


export async function adminGetEmployeeExpertiseDetail(req: Request, res: Response) {
    try {
        const {
            employeeId } = req.params;
        const {
            expertiseLevel,
            sortBy = "lastUpdatedAt",
            sortOrder = "desc",
            page = "1",
            limit = "20",
            dateFilter,   // "this_week" | "last_week" | "this_month" | "last_month" | "last_6_months" | "this_year" | "last_year"
            dateFrom,     // ISO string — custom range start (overrides dateFilter)
            dateTo,       // ISO string — custom range end (overrides dateFilter)
        } = req.query;

        const account = await prisma.account.findUnique({
            where: { id: employeeId },
            select: {
                id: true, firstName: true, lastName: true,
                contactEmail: true, avatar: true, designation: true, createdAt: true,
            },
        });
        if (!account) return sendErrorResponse(res, 404, "Employee not found");

        // ── Date range resolution ──────────────────────────────────────────
        // Custom range takes priority; named presets are computed from now (UTC).
        
        let createdAtFilter: Prisma.DateTimeFilter | undefined;

        if (dateFrom || dateTo) {
            // Explicit range — both sides optional
            createdAtFilter = {
                ...(dateFrom ? { gte: new Date(dateFrom as string) } : {}),
                ...(dateTo   ? { lte: new Date(dateTo   as string) } : {}),
            };
        } else if (dateFilter) {
            const now = new Date();

            // Helpers — all produce UTC midnight boundaries
            const startOfDay = (d: Date): Date => {
                const x = new Date(d);
                x.setUTCHours(0, 0, 0, 0);
                return x;
            };
            const startOfWeek = (d: Date): Date => {
                // Monday-based ISO week
                const x = startOfDay(d);
                const day = x.getUTCDay(); // 0 = Sun
                const diff = (day === 0 ? -6 : 1 - day);
                x.setUTCDate(x.getUTCDate() + diff);
                return x;
            };
            const startOfMonth = (d: Date): Date => {
                return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
            };
            const startOfYear = (d: Date): Date => {
                return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            };
            const endOfDay = (d: Date): Date => {
                const x = new Date(d);
                x.setUTCHours(23, 59, 59, 999);
                return x;
            };

            switch (dateFilter as string) {
                case "this_week": {
                    createdAtFilter = { gte: startOfWeek(now) };
                    break;
                }
                case "last_week": {
                    const thisWeekStart = startOfWeek(now);
                    const lastWeekStart = new Date(thisWeekStart);
                    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
                    const lastWeekEnd = new Date(thisWeekStart);
                    lastWeekEnd.setUTCMilliseconds(-1); // 1ms before this week
                    createdAtFilter = { gte: lastWeekStart, lte: lastWeekEnd };
                    break;
                }
                case "this_month": {
                    createdAtFilter = { gte: startOfMonth(now) };
                    break;
                }
                case "last_month": {
                    const thisMonthStart = startOfMonth(now);
                    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
                    const lastMonthEnd = new Date(thisMonthStart);
                    lastMonthEnd.setUTCMilliseconds(-1);
                    createdAtFilter = { gte: lastMonthStart, lte: lastMonthEnd };
                    break;
                }
                case "last_6_months": {
                    const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, now.getUTCDate()));
                    createdAtFilter = { gte: sixMonthsAgo };
                    break;
                }
                case "this_year": {
                    createdAtFilter = { gte: startOfYear(now) };
                    break;
                }
                case "last_year": {
                    const lastYearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
                    const lastYearEnd   = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
                    lastYearEnd.setUTCMilliseconds(-1);
                    createdAtFilter = { gte: lastYearStart, lte: lastYearEnd };
                    break;
                }
                // unknown preset — ignore
            }
        }

        // ── Where clauses ──────────────────────────────────────────────────

        // Filtered where (for the page query + count — respects level + date)
        const expertiseWhere: Prisma.UserProductExpertiseWhereInput = {
            userId: employeeId,
            ...(expertiseLevel ? { expertiseLevel: expertiseLevel as ExpertiseLevel } : {}),
            ...(createdAtFilter ? { lastUpdatedAt: createdAtFilter } : {}),
        };

        // Stats where (always global — no level filter, but DOES apply date filter
        // so summary stats reflect the same time window the user is browsing)
        const statsWhere: Prisma.UserProductExpertiseWhereInput = {
            userId: employeeId,
            ...(createdAtFilter ? { lastUpdatedAt: createdAtFilter } : {}),
        };

        // ── Sort ───────────────────────────────────────────────────────────

        const allowedSortFields = [
            "lastUpdatedAt", "expertiseLevel", "leadsConverted",
            "successRate", "demoCount", "yearsOfExperience", "createdAt",
        ];
        const orderByField = allowedSortFields.includes(sortBy as string)
            ? (sortBy as string) : "lastUpdatedAt";
        const orderByDir = sortOrder === "asc" ? "asc" : "desc";

        // ── Pagination ─────────────────────────────────────────────────────

        const pageNum  = Math.max(1, parseInt(page  as string, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
        const skip     = (pageNum - 1) * limitNum;

        // ── DB queries (parallel) ──────────────────────────────────────────

        const [totalCount, expertiseEntries, allForStats] = await Promise.all([
            // 1. filtered count (drives pagination)
            prisma.userProductExpertise.count({ where: expertiseWhere }),

            prisma.userProductExpertise.findMany({
                where: expertiseWhere,
                orderBy: { [orderByField]: orderByDir },
                skip,
                take: limitNum,
                select: {
                    id: true,
                    userId: true,
                    productCatalogId: true,
                    expertiseLevel: true,
                    yearsOfExperience: true,
                    leadsConverted: true,
                    leadsCount: true,
                    demoCount: true,
                    successRate: true,
                    completedProjects: true,
                    notes: true,
                    lastDemoAt: true,
                    lastLeadAt: true,
                    skills: true,
                    certifications: true,
                    createdAt: true,
                    lastUpdatedAt: true,
                    productCatalog: {
                        select: {
                            id: true, title: true, slug: true, subtitle: true,
                            finalPrice: true, basePrice: true, categorySlugs: true,
                            industrySlugs: true, isTopProduct: true, isLatest: true,
                            status: true, pricingModel: true, introVideoId: true,
                        },
                    },
                },
            }),

            // 3. lightweight all-rows for summary stats (same time window, no level filter)
            prisma.userProductExpertise.findMany({
                where: statsWhere,
                select: {
                    expertiseLevel: true,
                    leadsConverted: true,
                    leadsCount: true,
                    demoCount: true,
                    completedProjects: true,
                    successRate: true,
                    productCatalogId: true,
                    productCatalog: {
                        select: { title: true, slug: true, categorySlugs: true },
                    },
                },
            }),
        ]);

        // ── Summary (computed from all rows in the time window) ────────────

        const expertCount          = allForStats.filter(e => e.expertiseLevel === "EXPERT").length;
        const canDemoCount         = allForStats.filter(e => e.expertiseLevel === "CAN_DEMO").length;
        const learningCount        = allForStats.filter(e => e.expertiseLevel === "LEARNING").length;
        const guidanceCount        = allForStats.filter(e => e.expertiseLevel === "GUIDANCE_NEEDED").length;
        const noneCount            = allForStats.filter(e => e.expertiseLevel === "NONE").length;
        const totalLeadsConverted  = allForStats.reduce((s, e) => s + e.leadsConverted, 0);
        const totalLeadsCount = allForStats.reduce((s, e) => s + e.leadsCount, 0);
        const totalDemos           = allForStats.reduce((s, e) => s + e.demoCount, 0);
        const totalCompletedProjects = allForStats.reduce((s, e) => s + e.completedProjects, 0);
        const avgSuccessRate       = allForStats.length > 0
            ? allForStats.reduce((s, e) => s + e.successRate, 0) / allForStats.length : 0;

        const topProducts = [...allForStats]
            .sort((a, b) => b.leadsConverted - a.leadsConverted)
            .slice(0, 7)
            .map(e => ({
                productId:     e.productCatalogId,
                productTitle:  e.productCatalog.title,
                productSlug:   e.productCatalog.slug,
                expertiseLevel: e.expertiseLevel,
                leadsConverted: e.leadsConverted,
                successRate:    e.successRate,
                demoCount:      e.demoCount,
            }));

        const categoryCoverage: Record<string, number> = {};
        for (const e of allForStats) {
            for (const cat of e.productCatalog.categorySlugs ?? []) {
                categoryCoverage[cat] = (categoryCoverage[cat] ?? 0) + 1;
            }
        }

        // ── Format page entries ────────────────────────────────────────────

        const formattedEntries = expertiseEntries.map(e => ({
            id:               e.id,
            productCatalogId: e.productCatalogId,
            product:          e.productCatalog,
            expertiseLevel:   e.expertiseLevel,
            yearsOfExperience: e.yearsOfExperience ?? null,
            completedProjects: e.completedProjects,
            leadsConverted:   e.leadsConverted,
            leadsCount:       e.leadsCount,
            demoCount:        e.demoCount,
            successRate:      e.successRate,
            skills:           safeParseJson(e.skills),
            certifications:   safeParseJson(e.certifications),
            notes:            e.notes ?? null,
            lastDemoAt:       e.lastDemoAt ?? null,
            lastLeadAt:       e.lastLeadAt ?? null,
            lastUpdatedAt:    e.lastUpdatedAt,
            createdAt:        e.createdAt,
        }));

        const totalPages = Math.ceil(totalCount / limitNum);

        // ── Applied filter summary (so the client can show "Showing: Last Month") ──
        const appliedDateFilter = dateFrom || dateTo
            ? { type: "custom" as const, from: dateFrom ?? null, to: dateTo ?? null }
            : dateFilter
            ? { type: dateFilter as string }
            : null;

        return sendSuccessResponse(res, 200, "Employee expertise detail fetched", {
            employee: {
                id: account.id, firstName: account.firstName, lastName: account.lastName,
                contactEmail: account.contactEmail, avatar: account.avatar,
                designation: account.designation, memberSince: account.createdAt,
            },
            summary: {
                totalProducts: allForStats.length,
                expertCount, canDemoCount, learningCount, guidanceCount, noneCount, totalLeadsCount,
                totalLeadsConverted, totalDemos, totalCompletedProjects,
                avgSuccessRate: parseFloat(avgSuccessRate.toFixed(2)),
                levelBreakdown: {
                    EXPERT: expertCount, CAN_DEMO: canDemoCount,
                    LEARNING: learningCount, GUIDANCE_NEEDED: guidanceCount, NONE: noneCount,
                },
                categoryCoverage,
                topProducts,
            },
            expertise: formattedEntries,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalCount,
                totalPages,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1,
            },
            appliedFilters: {
                expertiseLevel: expertiseLevel ?? null,
                dateFilter: appliedDateFilter,
            },
        });
    } catch (error) {
        console.error("[AdminExpertise] adminGetEmployeeExpertiseDetail error", error);
        return sendErrorResponse(res, 500, "Failed to fetch employee expertise detail");
    }
}

// ─────────────────────────────────────
// ADMIN: GET PRODUCT COVERAGE OVERVIEW
// GET /expertise/tdl/admin/products
//
// For each active product, how many employees have marked it,
// broken down by expertise level. Useful for spotting gaps.
//
// Query params:
//   search        string
//   needsCoverage boolean  — only products with 0 experts
//   categorySlug  string
//   sortBy        "title" | "expertCount" | "totalMarked"
//   sortOrder     "asc" | "desc"
//   page / limit
// ─────────────────────────────────────

export async function adminGetProductCoverageOverview(
    req: Request,
    res: Response
) {
    try {
        const {
            search,
            needsCoverage,
            categorySlug,
            sortBy = "expertCount",
            sortOrder = "desc",
            page = "1",
            limit = "30",
        } = req.query;

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 30));

        // ── Fetch active products ──
        const productWhere: Prisma.ProductCatalogWhereInput = {
            isActive: true,
        };

        if (search) {
            productWhere.OR = [
                { title: { contains: search as string, mode: "insensitive" } },
                { slug: { contains: search as string, mode: "insensitive" } },
            ];
        }

        if (categorySlug) {
            productWhere.categorySlugs = { has: categorySlug as string };
        }

        const products = await prisma.productCatalog.findMany({
            where: productWhere,
            select: {
                id: true,
                title: true,
                slug: true,
                categorySlugs: true,
                isTopProduct: true,
                isLatest: true,
                finalPrice: true,
                userExpertise: {
                    select: {
                        expertiseLevel: true,
                        userId: true,
                        leadsConverted: true,
                        successRate: true,
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                avatar: true,
                                designation: true,
                            },
                        },
                    },
                },
            },
        });

        // ── Aggregate per product ──
        type ProductCoverage = {
            productId: string;
            title: string;
            slug: string;
            categorySlugs: string[];
            isTopProduct: boolean;
            isLatest: boolean;
            finalPrice: string | null;
            totalMarked: number;
            expertCount: number;
            canDemoCount: number;
            learningCount: number;
            guidanceCount: number;
            totalLeadsConverted: number;
            avgSuccessRate: number;
            covered: boolean;       // has at least 1 expert
            needsCoverage: boolean; // 0 experts
            experts: {
                userId: string;
                firstName: string;
                lastName: string;
                avatar: string | null;
                designation: string | null;
            }[];
        };

        let coverages: ProductCoverage[] = products.map((p) => {
            const ue = p.userExpertise;
            const expertCount = ue.filter((e) => e.expertiseLevel === "EXPERT").length;
            const canDemoCount = ue.filter((e) => e.expertiseLevel === "CAN_DEMO").length;
            const learningCount = ue.filter((e) => e.expertiseLevel === "LEARNING").length;
            const guidanceCount = ue.filter((e) => e.expertiseLevel === "GUIDANCE_NEEDED").length;
            const noneCount = ue.filter((e) => e.expertiseLevel === "NONE").length;
            const totalLeadsConverted = ue.reduce((s, e) => s + e.leadsConverted, 0);
            const avgSuccessRate =
                ue.length > 0
                    ? ue.reduce((s, e) => s + e.successRate, 0) / ue.length
                    : 0;

            const experts = ue
                .filter((e) => e.expertiseLevel === "EXPERT")
                .map((e) => ({
                    userId: e.userId,
                    firstName: e.user.firstName,
                    lastName: e.user.lastName,
                    avatar: e.user.avatar ?? null,
                    designation: e.user.designation ?? null,
                }));

            return {
                productId: p.id,
                title: p.title,
                slug: p.slug,
                categorySlugs: p.categorySlugs ?? [],
                isTopProduct: p.isTopProduct,
                isLatest: p.isLatest,
                finalPrice: p.finalPrice ? p.finalPrice.toString() : null,
                totalMarked: ue.length,
                expertCount,
                canDemoCount,
                learningCount,
                guidanceCount,
                noneCount,
                totalLeadsConverted,
                avgSuccessRate: parseFloat(avgSuccessRate.toFixed(2)),
                covered: expertCount > 0,
                needsCoverage: expertCount === 0,
                experts,
            };
        });

        // ── needsCoverage filter ──
        if (needsCoverage === "true") {
            coverages = coverages.filter((c) => c.needsCoverage);
        }

        // ── Sort ──
        const dir = sortOrder === "asc" ? 1 : -1;
        coverages.sort((a, b) => {
            switch (sortBy as string) {
                case "title":
                    return dir * a.title.localeCompare(b.title);
                case "totalMarked":
                    return dir * (a.totalMarked - b.totalMarked);
                case "expertCount":
                default:
                    return dir * (a.expertCount - b.expertCount);
            }
        });

        // ── Paginate ──
        const total = coverages.length;
        const paginated = coverages.slice(
            (pageNum - 1) * limitNum,
            pageNum * limitNum
        );

        // ── Summary stats ──
        const allCoverages = coverages; // full list for stats
        const overallStats = {
            totalActiveProducts: products.length,
            productsCovered: allCoverages.filter((c) => c.covered).length,
            productsNeedingCoverage: allCoverages.filter((c) => c.needsCoverage).length,
            totalExpertiseEntries: products.reduce(
                (s, p) => s + p.userExpertise.length,
                0
            ),
        };

        return sendSuccessResponse(
            res,
            200,
            "Product coverage overview fetched",
            paginated,
            {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNext: (pageNum - 1) * limitNum + limitNum < total,
                hasPrev: pageNum > 1,
                overallStats,
            }
        );
    } catch (error) {
        console.error(
            "[AdminExpertise] adminGetProductCoverageOverview error",
            error
        );
        return sendErrorResponse(res, 500, "Failed to fetch product coverage");
    }
}

// ─────────────────────────────────────
// Utility
// ─────────────────────────────────────

function safeParseJson(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}