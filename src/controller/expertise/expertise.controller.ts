import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { Prisma, ExpertiseLevel } from "@prisma/client";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";

// ─────────────────────────────────────
// SET/UPDATE USER EXPERTISE FOR A PRODUCT
// POST /expertise/tdl
// // ─────────────────────────────────────

export async function setUserExpertise(req: Request, res: Response) {
    try {
        const userId = (req as any).user?.accountId; // from auth middleware req.user?.accountId
        const { productCatalogId, expertiseLevel, notes, yearsOfExperience, skills } =
            req.body;

        if (
            !userId ||
            !productCatalogId ||
            !expertiseLevel
        ) {
            return sendErrorResponse(
                res,
                400,
                "Missing required fields"
            );
        }

        if (!Object.values(ExpertiseLevel).includes(expertiseLevel)) {

            return sendErrorResponse(
                res,
                400,
                "Invalid expertise level"
            );
        }

        // Verify product exists
        const product = await prisma.productCatalog.findUnique({
            where: { id: productCatalogId },
        });

        if (!product) {
            return sendErrorResponse(
                res,
                404,
                "TDL not found" 
            );
        }

        const expertise = await prisma.userProductExpertise.upsert({
            where: {
                userId_productCatalogId: {
                    userId,
                    productCatalogId,
                },
            },
            create: {
                userId,
                productCatalogId,
                expertiseLevel,
                notes,
                yearsOfExperience: yearsOfExperience || undefined,
                skills: skills || []
            },
            update: {
                expertiseLevel,
                notes,
                yearsOfExperience: yearsOfExperience || undefined,
                lastUpdatedAt: new Date(),
                skills: skills || []
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        contactEmail: true,
                        avatar: true,
                    },
                },
                productCatalog: {
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                        introVideoId: true,
                    },
                },
            },
        });

        return sendSuccessResponse(
            res,
            200,
            "User expertise updated successfully",
            expertise
        );
    } catch (error) {
        console.error("[UserExpertise] setUserExpertise error", error);
        return sendErrorResponse(
            res,
            500,
            "Failed to set user expertise"
        );
    }
}

// ─────────────────────────────────────
// GET USER'S PRODUCT EXPERTISE
// GET /expertise/tdl/me
// Returns all products the user marked with expertise level
// ─────────────────────────────────────

export async function getMyExpertise(req: Request, res: Response) {
    try {
        const userId = (req as any).user?.accountId;
        const { expertiseLevel, search, sortBy = "lastUpdatedAt", sortOrder = "desc" } =
            req.query;

        const where: Prisma.UserProductExpertiseWhereInput = {
            userId,
        };

        if (expertiseLevel) {
            where.expertiseLevel = expertiseLevel as ExpertiseLevel;
        }

        if (search) {
            where.productCatalog = {
                OR: [
                    { title: { contains: search as string, mode: "insensitive" } },
                    { slug: { contains: search as string, mode: "insensitive" } },
                ],
            };
        }

        const allowedSortFields = ["lastUpdatedAt", "expertiseLevel", "leadsConverted", "successRate"];
        const orderByField = allowedSortFields.includes(sortBy as string)
            ? (sortBy as string)
            : "lastUpdatedAt";

        const orderByDir = sortOrder === "asc" ? "asc" : "desc";

        const expertise = await prisma.userProductExpertise.findMany({
            where,
            orderBy: { [orderByField]: orderByDir },
            include: {
                productCatalog: {
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                        subtitle: true,
                        basePrice: true,
                        finalPrice: true,
                        categorySlugs: true,
                        introVideoId: true,
                    },
                },
            },
        });

        // Add summary stats
        const stats = {
            totalProducts: expertise.length,
            expertCount: expertise.filter((e) => e.expertiseLevel === "EXPERT").length,
            canDemoCount: expertise.filter((e) => e.expertiseLevel === "CAN_DEMO").length,
            learningCount: expertise.filter((e) => e.expertiseLevel === "LEARNING").length,
            guidanceCount: expertise.filter((e) => e.expertiseLevel === "GUIDANCE_NEEDED").length,
            totalLeadsConverted: expertise.reduce((sum, e) => sum + e.leadsConverted, 0),
            avgSuccessRate: expertise.length > 0
                ? (expertise.reduce((sum, e) => sum + e.successRate, 0) / expertise.length).toFixed(2)
                : 0,
        };

        return sendSuccessResponse(
            res,
            200,
            "Expertise fetched successfully",
            expertise,
            { stats }
        );
    } catch (error) {
        console.error("[UserExpertise] getMyExpertise error", error);

        return sendErrorResponse(
            res,
            500,
            "Failed to fetch expertise"
        );
    }
}

// ─────────────────────────────────────
// GET EXPERTS FOR A PRODUCT
// GET /expertise/tdl/product/:productId
// Find all users who marked expertise for this product
// ─────────────────────────────────────

export async function getProductExperts(req: Request, res: Response) {
    try {
        const { productId } = req.params;
        const { expertiseLevel } = req.query;

        const where: Prisma.UserProductExpertiseWhereInput = {
            productCatalogId: productId,
        };

        if (expertiseLevel) {
            where.expertiseLevel = expertiseLevel as ExpertiseLevel;
        }

        const experts = await prisma.userProductExpertise.findMany({
            where,
            orderBy: { leadsConverted: "desc" },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        contactEmail: true,
                        avatar: true,
                        designation: true,
                    },
                },
            },
        });

        return res.json({
            success: true,
            data: experts,
        });
    } catch (error) {
        console.error("[UserExpertise] getProductExperts error", error);

        return sendErrorResponse(
            res,
            500,
            "Failed to fetch TDL experts"
        );
    }
}

// ─────────────────────────────────────
// DELETE EXPERTISE RECORD
// DELETE /expertise/tdl/:id
// User removes a product from their expertise
// ─────────────────────────────────────

export async function removeExpertise(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.accountId;

        const expertise = await prisma.userProductExpertise.findUnique({
            where: { id },
        });

        if (!expertise) {

            return sendErrorResponse(
                res,
                404,
                "Expertise record not found"
            );
        }

        // Verify user owns this record
        if (expertise.userId !== userId) {

            return sendErrorResponse(
                res,
                403,
                "Unauthorized"
            );
        }

        await prisma.userProductExpertise.delete({
            where: { id },
        });

        return res.json({
            success: true,
            message: "Expertise record removed",
        });
    } catch (error) {
        console.error("[UserExpertise] removeExpertise error", error);

        return sendErrorResponse(
            res,
            500,
            "Failed to remove expertise"
        );
    }
}

// ─────────────────────────────────────
// TEAM SKILL MATRIX
// GET /expertise/tdl/team/:teamId/matrix
// Show which team members know which products
// ─────────────────────────────────────

export async function getTeamSkillMatrix(req: Request, res: Response) {
    try {
        const { teamId } = req.params;

        // Get all team members
        const teamMembers = await prisma.teamMember.findMany({
            where: { teamId, isActive: true },
            include: {
                account: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        designation: true,
                    },
                },
            },
        });

        const memberIds = teamMembers.map((m) => m.accountId);

        // Get all expertise records for team members
        const expertise = await prisma.userProductExpertise.findMany({
            where: { userId: { in: memberIds } },
            include: {
                productCatalog: {
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                        introVideoId: true,
                    },
                },
            },
        });

        // Build matrix: memberName -> [products with levels]
        const matrix = teamMembers.map((member) => ({
            memberId: member.accountId,
            name: `${member.account.firstName} ${member.account.lastName}`,
            designation: member.account.designation,
            products: expertise
                .filter((e) => e.userId === member.accountId)
                .map((e) => ({
                    productId: e.productCatalogId,
                    productTitle: e.productCatalog.title,
                    productSlug: e.productCatalog.slug,
                    expertiseLevel: e.expertiseLevel,
                    leadsConverted: e.leadsConverted,
                    successRate: e.successRate,
                })),
            totalProductsKnown: expertise.filter((e) => e.userId === member.accountId)
                .length,
            expertCount: expertise.filter(
                (e) => e.userId === member.accountId && e.expertiseLevel === "EXPERT"
            ).length,
        }));

        // Identify skill gaps
        const allProducts = await prisma.productCatalog.findMany({
            where: { isActive: true },
            select: { id: true, title: true, slug: true },
        });

        const skillGaps = allProducts.map((product) => {
            const knowersCount = expertise.filter(
                (e) => e.productCatalogId === product.id && e.expertiseLevel === "EXPERT"
            ).length;

            return {
                productId: product.id,
                productTitle: product.title,
                knownByExperts: knowersCount,
                covered: knowersCount > 0,
                needsCoverage: knowersCount === 0,
            };
        });

        return sendSuccessResponse(
            res,
            200,
            "Team skill matrix fetched successfully",
            {
                matrix,
                skillGaps,
                summary: {
                    teamSize: teamMembers.length,
                    totalProductsCovered: expertise
                        .map((e) => e.productCatalogId)
                        .filter((v, i, a) => a.indexOf(v) === i).length,
                    productsWithoutExpert: skillGaps.filter((g) => !g.covered).length,
                },
            }
        );
    } catch (error) {
        console.error("[UserExpertise] getTeamSkillMatrix error", error);

        return sendErrorResponse(
            res,
            500,
            "Failed to fetch team skill matrix"
        );
    }
}


