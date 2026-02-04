import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* ======================================================
   LIST EMPLOYEES (BASIC INFO)
====================================================== */
export async function listEmployees(req: Request, res: Response) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const skip = (page - 1) * limit;

    const searchRaw = (req.query.search as string)?.trim();
    const search = searchRaw?.toLowerCase();

    /* ===============================
       isActive HANDLING
       - default: true
       - ?isActive=false → inactive list
    =============================== */
    const isActiveParam = req.query.isActive;
    const isActive =
      isActiveParam === undefined ? true : isActiveParam === "true";

    /* ===============================
       SEARCH LOGIC
    =============================== */
    let where: any = {
      isActive,
    };
    const { isBusy } = req.query;
    if (isBusy !== undefined) {
      if (isBusy === "true") {
        where.isBusy = true;
      } else if (isBusy === "false") {
        where.isBusy = false;
      } else {
        return res.status(400).json({
          message: "isBusy must be 'true' or 'false'",
        });
      }
    }

    if (search) {
      const parts = search.split(/\s+/);

      where.OR = [
        {
          firstName: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          lastName: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          contactEmail: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          contactPhone: {
            contains: search,
          },
        },
        ...(parts.length >= 2
          ? [
              {
                AND: [
                  {
                    firstName: {
                      contains: parts[0],
                      mode: "insensitive",
                    },
                  },
                  {
                    lastName: {
                      contains: parts.slice(1).join(" "),
                      mode: "insensitive",
                    },
                  },
                ],
              },
            ]
          : []),
      ];
    }

    const [total, data] = await prisma.$transaction([
      prisma.account.count({ where }),
      prisma.account.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          contactEmail: true,
          contactPhone: true,
          designation: true,
          isBusy: true,
          avatar: true,
          jobType: true,
          isActive: true,
          joinedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Employees fetched", {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        isActive,
      },
    });
  } catch (err) {
    console.error("listEmployees error:", err);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}

/* ======================================================
   EMPLOYEE DETAILS (FULL)
====================================================== */
export async function getEmployeeDetails(req: Request, res: Response) {
  try {
    const { accountId } = req.params;

    const employee = await prisma.account.findUnique({
      where: { id: accountId },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: {
                      include: { permission: true },
                    },
                  },
                },
              },
            },
          },
        },
        jobDescriptions: true,
        registration: true,
        bankDetails: true,
      },
    });

    if (!employee) {
      return sendErrorResponse(res, 404, "Employee not found");
    }

    return sendSuccessResponse(res, 200, "Employee details fetched", employee);
  } catch (err) {
    console.error("getEmployeeDetails error:", err);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}

/* ======================================================
   UPDATE EMPLOYEE: isActive, jobType, designation
====================================================== */
export async function updateEmployee(req: Request, res: Response) {
  try {
    const { accountId } = req.params;

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: req.body,
    });

    return sendSuccessResponse(res, 200, "Employee updated", updated);
  } catch (err) {
    console.error("updateEmployee error:", err);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}

/* ======================================================
   DELETE EMPLOYEE
====================================================== */
export async function deleteEmployee(req: Request, res: Response) {
  try {
    const { accountId } = req.params;

    await prisma.$transaction([
      prisma.userRole.deleteMany({
        where: { user: { accountId } },
      }),
      prisma.user.deleteMany({
        where: { accountId },
      }),
      prisma.jobDescription.deleteMany({
        where: { accountId },
      }),
      prisma.registrationRequest.deleteMany({
        where: { accountId },
      }),
      prisma.account.delete({
        where: { id: accountId },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Employee deleted");
  } catch (err) {
    console.error("deleteEmployee error:", err);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}

/* ======================================================
   UPDATE EMPLOYEE ROLES
====================================================== */
export async function updateEmployeeRoles(req: Request, res: Response) {
  try {
    const { accountId } = req.params;
    const { roleIds } = req.body;

    const user = await prisma.user.findUnique({
      where: { accountId },
    });

    if (!user) return sendErrorResponse(res, 404, "User not found");

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: user.id } }),
      prisma.userRole.createMany({
        data: roleIds.map((roleId: string) => ({
          userId: user.id,
          roleId,
        })),
      }),
    ]);

    return sendSuccessResponse(res, 200, "Roles updated");
  } catch (err) {
    console.error("updateEmployeeRoles error:", err);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}
