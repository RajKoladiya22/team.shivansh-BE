import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

export async function getAccountIdFromReqUser(user: any): Promise<string | null> {
  if (!user) return null;
  if (user.accountId) return user.accountId;
  const acc = await prisma.account.findFirst({
    where: { id: user.id },
    select: { id: true },
  });
  return acc?.id || user.id || null;
}

/**
 * GET /outsource-developers
 * List outsource developers with search, active filter, and pagination.
 */
export async function listOutsourceDevelopers(req: Request, res: Response) {
  try {
    const { search, isActive, page = "1", limit = "50" } = req.query;

    const where: any = {
      deletedAt: null,
    };

    if (isActive !== undefined && isActive !== "") {
      where.isActive = String(isActive) === "true";
    }

    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { skills: { contains: q, mode: "insensitive" } },
      ];
    }

    const isAll = limit === "all" || limit === "-1";
    const take = isAll ? undefined : Math.max(1, parseInt(limit as string, 10) || 50);
    const skip = isAll ? undefined : (Math.max(1, parseInt(page as string, 10) || 1) - 1) * (take || 50);

    const [total, developers] = await Promise.all([
      prisma.outsourceDeveloper.count({ where }),
      prisma.outsourceDeveloper.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              projects: {
                where: { deletedAt: null },
              },
            },
          },
        },
      }),
    ]);

    sendSuccessResponse(res, 200, "Outsource developers fetched successfully", {
      data: developers,
      total,
      page: isAll ? 1 : parseInt(page as string, 10) || 1,
      limit: isAll ? total : take,
      totalPages: isAll || !take ? 1 : Math.ceil(total / take),
    });
  } catch (error: any) {
    console.error("[outsourceDeveloper.controller] listOutsourceDevelopers:", error);
    sendErrorResponse(res, 500, error.message || "Failed to fetch outsource developers");
  }
}

/**
 * GET /outsource-developers/:id
 * Get single outsource developer details with linked projects.
 */
export async function getOutsourceDeveloperById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const developer = await prisma.outsourceDeveloper.findFirst({
      where: { id, deletedAt: null },
      include: {
        projects: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            status: true,
            priority: true,
            onWork: true,
            projectType: true,
            projectSource: true,
            startDate: true,
            endDate: true,
            completedAt: true,
          },
        },
      },
    });

    if (!developer) {
      return sendErrorResponse(res, 404, "Outsource developer not found");
    }

    sendSuccessResponse(res, 200, "Outsource developer fetched successfully", developer);
  } catch (error: any) {
    console.error("[outsourceDeveloper.controller] getOutsourceDeveloperById:", error);
    sendErrorResponse(res, 500, error.message || "Failed to fetch outsource developer");
  }
}

/**
 * POST /outsource-developers
 * Create a new outsource developer.
 */
export async function createOutsourceDeveloper(req: Request, res: Response) {
  try {
    const { name, email, phone, skills, notes, isActive } = req.body;
    const user = (req as any).user;
    const accountId = await getAccountIdFromReqUser(user);

    if (!name || !String(name).trim()) {
      return sendErrorResponse(res, 400, "Developer name is required");
    }

    const developer = await prisma.outsourceDeveloper.create({
      data: {
        name: String(name).trim(),
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
        skills: skills ? String(skills).trim() : null,
        notes: notes ? String(notes).trim() : null,
        isActive: isActive === undefined ? true : Boolean(isActive === true || isActive === "true"),
        createdBy: accountId,
      },
    });

    sendSuccessResponse(res, 201, "Outsource developer created successfully", developer);
  } catch (error: any) {
    console.error("[outsourceDeveloper.controller] createOutsourceDeveloper:", error);
    sendErrorResponse(res, 500, error.message || "Failed to create outsource developer");
  }
}

/**
 * PATCH /outsource-developers/:id
 * Update an outsource developer record.
 */
export async function updateOutsourceDeveloper(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { name, email, phone, skills, notes, isActive } = req.body;

    const existing = await prisma.outsourceDeveloper.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      return sendErrorResponse(res, 404, "Outsource developer not found");
    }

    const data: Record<string, any> = {};
    if (name !== undefined) data.name = String(name).trim();
    if (email !== undefined) data.email = email ? String(email).trim() : null;
    if (phone !== undefined) data.phone = phone ? String(phone).trim() : null;
    if (skills !== undefined) data.skills = skills ? String(skills).trim() : null;
    if (notes !== undefined) data.notes = notes ? String(notes).trim() : null;
    if (isActive !== undefined) data.isActive = Boolean(isActive === true || isActive === "true");

    const updated = await prisma.outsourceDeveloper.update({
      where: { id },
      data,
    });

    sendSuccessResponse(res, 200, "Outsource developer updated successfully", updated);
  } catch (error: any) {
    console.error("[outsourceDeveloper.controller] updateOutsourceDeveloper:", error);
    sendErrorResponse(res, 500, error.message || "Failed to update outsource developer");
  }
}

/**
 * DELETE /outsource-developers/:id
 * Hard delete an outsource developer permanently.
 */
export async function deleteOutsourceDeveloper(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const existing = await prisma.outsourceDeveloper.findUnique({
      where: { id },
    });
    if (!existing) {
      return sendErrorResponse(res, 404, "Outsource developer not found");
    }

    // Unlink any projects assigned to this developer
    await prisma.project.updateMany({
      where: { outsourceDeveloperId: id },
      data: { outsourceDeveloperId: null },
    });

    await prisma.outsourceDeveloper.delete({
      where: { id },
    });

    sendSuccessResponse(res, 200, "Outsource developer deleted permanently");
  } catch (error: any) {
    console.error("[outsourceDeveloper.controller] deleteOutsourceDeveloper:", error);
    sendErrorResponse(res, 500, error.message || "Failed to delete outsource developer");
  }
}
