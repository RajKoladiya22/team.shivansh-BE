// src/controller/common/employye.controller.ts

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * GET /employees
 * Universal employee directory
 */
export async function listEmployees(req: Request, res: Response) {
  try {
    const {
      search,
      teamId,
      role,
      designation,
      jobType,
      isActive = "true",
      isBusy,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);

    const where: any = {};

    // Active employees only by default
    if (isActive !== "all") {
      where.isActive = isActive === "true";
    }

    if (jobType) where.jobType = jobType;
    if (designation) {
      where.designation = { contains: designation, mode: "insensitive" };
    }

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
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { contactPhone: { contains: search } },
        { contactEmail: { contains: search, mode: "insensitive" } },
        { registerNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    if (teamId) {
      where.teams = {
        some: { teamId, isActive: true },
      };
    }

    if (role) {
      where.user = {
        roles: {
          has: role as any,
        },
      };
    }

    const [total, accounts] = await prisma.$transaction([
      prisma.account.count({ where }),
      prisma.account.findMany({
        where,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        orderBy: { firstName: "asc" },
        select: {
          id: true,
          registerNumber: true,
          firstName: true,
          lastName: true,
          designation: true,
          contactPhone: true,
          contactEmail: true,
          avatar: true,
          isBusy: true,
          //   user: {
          //     select: { roles: true },
          //   },
          teams: {
            where: { isActive: true },
            select: {
              team: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    const data = accounts.map((a) => ({
      id: a.id,
      registerNumber: a.registerNumber,
      name: `${a.firstName} ${a.lastName}`.trim(),
      firstName: a.firstName,
      lastName: a.lastName,
      designation: a.designation,
      contactPhone: a.contactPhone,
      contactEmail: a.contactEmail,
      avatar: a.avatar,
      isBusy: a.isBusy,
      //   roles: a.user?.roles ?? [],
      teams: a.teams.map((t) => t.team),
    }));

    return sendSuccessResponse(res, 200, "Employees fetched", {
      data,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    console.error("listEmployees error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch employees",
    );
  }
}


/**
 * GET /common/employees/:id
 * Employee basic profile (common access)
 */
export async function getEmployeeById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return sendErrorResponse(res, 400, "Employee id is required");
    }

    const account = await prisma.account.findUnique({
      where: { id },
      select: {
        id: true,
        registerNumber: true,
        firstName: true,
        lastName: true,
        designation: true,
        jobType: true,
        contactPhone: true,
        contactEmail: true,
        avatar: true,
        bio: true,
        address: true,
        isBusy: true,
        isActive: true,
        joinedAt: true,
        createdAt: true,

        teams: {
          where: { isActive: true },
          select: {
            role: true,
            team: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!account || !account.isActive) {
      return sendErrorResponse(res, 404, "Employee not found");
    }

    const response = {
      id: account.id,
      registerNumber: account.registerNumber,
      name: `${account.firstName} ${account.lastName}`.trim(),
      firstName: account.firstName,
      lastName: account.lastName,
      designation: account.designation,
      jobType: account.jobType,
      contactPhone: account.contactPhone,
      contactEmail: account.contactEmail,
      avatar: account.avatar,
      bio: account.bio,
      address: account.address,
      isBusy: account.isBusy,
      joinedAt: account.joinedAt,
      createdAt: account.createdAt,

      teams: account.teams.map((t) => ({
        id: t.team.id,
        name: t.team.name,
        description: t.team.description,
        role: t.role, // LEAD | MEMBER | null
      })),
    };

    return sendSuccessResponse(res, 200, "Employee fetched", response);
  } catch (err: any) {
    console.error("getEmployeeById error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch employee",
    );
  }
}