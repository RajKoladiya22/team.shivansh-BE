import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { Decimal } from "@prisma/client/runtime/client";

export async function upsertSalaryStructure(req: Request, res: Response) {
  try {
    const adminId = (req as any).user.id;
    const {
      accountId,
      baseSalary,
      hraPercent,
      allowance,
      effectiveFrom,
      reason,
    } = req.body;

    if (!accountId || !baseSalary || !effectiveFrom) {
      return sendErrorResponse(res, 400, "Missing required fields");
    }

    const existing = await prisma.salaryStructure.findUnique({
      where: { accountId },
    });

    const structure = await prisma.$transaction(async (tx) => {
      if (!existing) {
        return tx.salaryStructure.create({
          data: {
            accountId,
            baseSalary,
            hraPercent,
            allowance,
            effectiveFrom,
            createdBy: adminId,
          },
        });
      }

      await tx.salaryRevision.create({
        data: {
          salaryStructureId: existing.id,
          previousSalary: existing.baseSalary,
          revisedSalary: baseSalary,
          applicableFrom: effectiveFrom,
          reason,
          revisedBy: adminId,
        },
      });

      return tx.salaryStructure.update({
        where: { id: existing.id },
        data: {
          baseSalary,
          hraPercent,
          allowance,
          effectiveFrom,
        },
      });
    });

    sendSuccessResponse(res, 200, "Salary structure updated", structure);
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to update salary");
  }
}

export async function getSalaryStructure(req: Request, res: Response) {
  try {
    const authUser = (req as any).user;
    if (!authUser?.id) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const { accountId, includeRevisions } = req.query;

    /* =========================
       DETERMINE TARGET ACCOUNT
    ========================== */

    let targetAccountId: string;

    if (accountId) {
      // 🔒 ADMIN ONLY
      if (!authUser.roles?.includes("ADMIN")) {
        return sendErrorResponse(res, 403, "Forbidden");
      }
      targetAccountId = String(accountId);
    } else {
      // EMPLOYEE → OWN ACCOUNT
      const user = await prisma.user.findUnique({
        where: { id: authUser.id },
        select: { accountId: true },
      });

      if (!user) {
        return sendErrorResponse(res, 404, "User not found");
      }

      targetAccountId = user.accountId;
    }

    /* =========================
       FETCH STRUCTURE
    ========================== */

    // const structure = await prisma.salaryStructure.findUnique({
    //   where: { accountId: targetAccountId },
    //   include: {
    //     revisions: includeRevisions === "true",
    //   },
    // });

    const structure = await prisma.salaryStructure.findUnique({
      where: { accountId: targetAccountId },
      include: {
        revisions:
          includeRevisions === "true"
            ? {
                orderBy: {
                  applicableFrom: "desc", // ✅ latest first
                },
              }
            : false,
      },
    });

    if (!structure) {
      return sendErrorResponse(res, 404, "Salary structure not found");
    }

    sendSuccessResponse(res, 200, "Salary structure fetched", structure);
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to fetch salary structure");
  }
}

export async function generateMonthlySalary(req: Request, res: Response) {
  try {
    const adminId = (req as any).user.id;
    const { accountId, month, year, deductions, note } = req.body;

    if (!accountId || !month || !year) {
      return sendErrorResponse(res, 400, "Missing required fields");
    }

    const structure = await prisma.salaryStructure.findUnique({
      where: { accountId },
    });

    if (!structure) {
      return sendErrorResponse(res, 404, "Salary structure not found");
    }

    // 🚫 Prevent duplicate salary generation
    const exists = await prisma.monthlySalary.findUnique({
      where: {
        accountId_month_year: { accountId, month, year },
      },
    });

    if (exists) {
      return sendErrorResponse(
        res,
        409,
        "Salary already generated for this month"
      );
    }

    /* =========================
       SAFE DECIMAL CALCULATIONS
    ========================== */

    const basic = structure.baseSalary; // Decimal

    const hra = structure.hraPercent
      ? basic.mul(structure.hraPercent).div(100)
      : new Decimal(0);

    const allowance = structure.allowance ?? new Decimal(0);

    const deductionAmount = deductions
      ? new Decimal(deductions)
      : new Decimal(0);

    const netPay = basic.add(hra).add(allowance).sub(deductionAmount);

    /* =========================
       CREATE MONTHLY SALARY
    ========================== */

    const salary = await prisma.monthlySalary.create({
      data: {
        accountId,
        salaryStructureId: structure.id,
        month,
        year,
        basic,
        hra,
        allowances: allowance,
        deductions: deductionAmount,
        netPay,
        note: note || null,
        status: "GENERATED",
        generatedAt: new Date(),
      },
    });

    /* =========================
       NOTIFY EMPLOYEE
    ========================== */

    await prisma.salaryNotice.create({
      data: {
        accountId,
        monthlySalaryId: salary.id,
        sentBy: adminId,
        message: `Salary generated for ${month}/${year}`,
      },
    });

    sendSuccessResponse(res, 201, "Monthly salary generated", salary);
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to generate salary");
  }
}

export async function getSalaryStatement(req: Request, res: Response) {
  try {
    const authUser = (req as any).user;
    if (!authUser?.id) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }
    const { month, year, startDate, endDate, accountId } = req.query;

    const user = await prisma.user.findUnique({ where: { id: authUser?.id } });
    if (!user) return sendErrorResponse(res, 404, "User not found");

    let targetAccountId: string;

    if (accountId) {
      // ADMIN ONLY
      if (!authUser.roles?.includes("ADMIN")) {
        return sendErrorResponse(res, 403, "Forbidden");
      }
      targetAccountId = String(accountId);
    } else {
      const user = await prisma.user.findUnique({
        where: { id: authUser.id },
        select: { accountId: true },
      });

      if (!user) {
        return sendErrorResponse(res, 404, "User not found");
      }

      targetAccountId = user.accountId;
    }

    if ((month || year) && (startDate || endDate)) {
      return sendErrorResponse(
        res,
        400,
        "Use either month/year or startDate/endDate, not both"
      );
    }
    // const where: any = {
    //   accountId: user.accountId,
    // };
    const where: any = {
      accountId: targetAccountId,
    };
    // 🔹 Single month
    if (month && year) {
      where.month = Number(month);
      where.year = Number(year);
    }

    // 🔹 Date range
    // if (startDate || endDate) {
    //   where.generatedAt = {};

    //   if (startDate) {
    //     where.generatedAt.gte = new Date(String(startDate));
    //   }
    //   if (endDate) {
    //     where.generatedAt.lte = new Date(String(endDate));
    //   }
    // }

    // 🔹 Month-Year range (derived from startDate / endDate)
    if (startDate || endDate) {
      const conditions: any[] = [];

      if (startDate) {
        const sd = new Date(String(startDate));
        const startYear = sd.getFullYear();
        const startMonth = sd.getMonth() + 1;

        conditions.push({
          OR: [
            { year: { gt: startYear } },
            {
              year: startYear,
              month: { gte: startMonth },
            },
          ],
        });
      }

      if (endDate) {
        const ed = new Date(String(endDate));
        const endYear = ed.getFullYear();
        const endMonth = ed.getMonth() + 1;

        conditions.push({
          OR: [
            { year: { lt: endYear } },
            {
              year: endYear,
              month: { lte: endMonth },
            },
          ],
        });
      }

      where.AND = conditions;
    }

    const salary = await prisma.monthlySalary.findMany({
      where,
      include: {
        statement: true,
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (!salary)
      return sendErrorResponse(res, 404, "No salary statements found");

    sendSuccessResponse(res, 200, "Salary statement", salary);
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to fetch statement");
  }
}

export async function getMySalaryNotices(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    const notices = await prisma.salaryNotice.findMany({
      where: { accountId: user.accountId },
      orderBy: { sentAt: "desc" },
    });

    sendSuccessResponse(res, 200, "Salary notices", notices);
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to fetch notices");
  }
}
