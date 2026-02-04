// src/controller/open/employye.controller.ts

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
      excludeBusy,
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

    if (excludeBusy === "true") {
      where.isBusy = false;
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
