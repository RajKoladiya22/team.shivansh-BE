// src/controller/admin/target.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import {
  TargetPeriodType,
  TargetCategory,
  TargetScope,
  TargetStatus,
} from "@prisma/client";

// Admin access assertion
function assertAdmin(req: Request, res: Response): boolean {
  const roles = req.user?.roles ?? [];
  const normalized = Array.isArray(roles)
    ? roles.map((r) => String(r).toUpperCase())
    : [String(roles).toUpperCase()];

  if (!normalized.includes("ADMIN") && !normalized.includes("PRIMARY_ADMIN")) {
    sendErrorResponse(res, 403, "Forbidden: Admin access required");
    return false;
  }
  return true;
}

/**
 * Format currency helper in Lakhs / Crores
 */
export function formatINRSummary(amount: number): { formatted: string; label: string } {
  if (Math.abs(amount) >= 10000000) {
    return {
      formatted: `${(amount / 10000000).toFixed(2)} Cr`,
      label: `${(amount / 10000000).toFixed(2)} Crores`,
    };
  }
  if (Math.abs(amount) >= 100000) {
    return {
      formatted: `${(amount / 100000).toFixed(2)} L`,
      label: `${(amount / 100000).toFixed(2)} Lakhs`,
    };
  }
  return {
    formatted: `₹${amount.toLocaleString("en-IN")}`,
    label: `₹${amount.toLocaleString("en-IN")}`,
  };
}

/**
 * Calculate system achievements for any arbitrary date window (single period fallback)
 */
async function calculateAchievementMetrics(startDate: Date, endDate: Date, accountId?: string) {
  const leadCreatedWhere: any = {
    createdAt: { gte: startDate, lte: endDate },
  };
  if (accountId) {
    leadCreatedWhere.OR = [
      { createdBy: accountId },
      { assignments: { some: { accountId, isActive: true } } },
    ];
  }

  const convertedWhere: any = {
    status: "CONVERTED",
    OR: [
      { closedAt: { gte: startDate, lte: endDate } },
      { closedAt: null, createdAt: { gte: startDate, lte: endDate } },
    ],
  };
  if (accountId) {
    convertedWhere.AND = [
      {
        OR: [
          { createdBy: accountId },
          { assignments: { some: { accountId, isActive: true } } },
        ],
      },
    ];
  }

  const quotationWhere: any = {
    status: { in: ["ACCEPTED", "CONVERTED"] },
    quotationDate: { gte: startDate, lte: endDate },
  };
  if (accountId) {
    quotationWhere.OR = [{ createdBy: accountId }, { preparedBy: accountId }];
  }

  // Execute database aggregations concurrently in a single Promise.all
  const [leadCreated, convertedAgg, quotationAgg] = await Promise.all([
    prisma.lead.count({ where: leadCreatedWhere }),
    prisma.lead.aggregate({
      where: convertedWhere,
      _count: { id: true },
      _sum: { cost: true },
    }),
    prisma.quotation.aggregate({
      where: quotationWhere,
      _sum: { grandTotal: true },
    }),
  ]);

  const leadConverted = convertedAgg._count?.id ?? 0;
  const leadRevenue = Number(convertedAgg._sum?.cost ?? 0);
  const quotationRevenue = Number(quotationAgg._sum?.grandTotal ?? 0);
  const realizedRevenue = Math.max(leadRevenue + quotationRevenue, 0);

  return {
    leadCreated,
    leadConverted,
    realizedRevenue,
    leadRevenue,
    quotationRevenue,
  };
}

interface InMemAchievement {
  leadCreated: number;
  leadConverted: number;
  realizedRevenue: number;
  leadRevenue: number;
  quotationRevenue: number;
}

/**
 * Fast in-memory evaluator for any arbitrary date window from pre-fetched lean records
 */
function calculateAchievementFromMemory(
  startDate: Date,
  endDate: Date,
  leads: Array<{
    createdAt: Date;
    closedAt: Date | null;
    status: string;
    cost: any;
  }>,
  quotations: Array<{
    quotationDate: Date;
    grandTotal: any;
  }>
): InMemAchievement {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  let leadCreated = 0;
  let leadConverted = 0;
  let leadRevenue = 0;

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    const createdMs = l.createdAt ? new Date(l.createdAt).getTime() : 0;
    if (createdMs >= startMs && createdMs <= endMs) {
      leadCreated++;
    }

    if (l.status === "CONVERTED") {
      const convDate = l.closedAt || l.createdAt;
      if (convDate) {
        const convMs = new Date(convDate).getTime();
        if (convMs >= startMs && convMs <= endMs) {
          leadConverted++;
          leadRevenue += l.cost ? Number(l.cost) : 0;
        }
      }
    }
  }

  let quotationRevenue = 0;
  for (let i = 0; i < quotations.length; i++) {
    const q = quotations[i];
    const qMs = q.quotationDate ? new Date(q.quotationDate).getTime() : 0;
    if (qMs >= startMs && qMs <= endMs) {
      quotationRevenue += q.grandTotal ? Number(q.grandTotal) : 0;
    }
  }

  const realizedRevenue = Math.max(leadRevenue + quotationRevenue, 0);

  return {
    leadCreated,
    leadConverted,
    realizedRevenue,
    leadRevenue,
    quotationRevenue,
  };
}

/**
 * Helper to build date range for quarters
 */
function getQuarterRange(year: number, quarter: number) {
  const qStartMonth = (quarter - 1) * 3;
  const qEndMonth = qStartMonth + 2;
  const startDate = new Date(Date.UTC(year, qStartMonth, 1, 0, 0, 0, 0));
  const lastDay = new Date(Date.UTC(year, qEndMonth + 1, 0)).getDate();
  const endDate = new Date(Date.UTC(year, qEndMonth, lastDay, 23, 59, 59, 999));
  return { startDate, endDate };
}

/**
 * Helper to build date range for months
 */
function getMonthRange(year: number, month: number) {
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const lastDay = new Date(Date.UTC(year, month, 0)).getDate();
  const endDate = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999));
  return { startDate, endDate, lastDay };
}

/**
 * Helper to build 4-5 weekly segments for a month
 */
interface WeekSegment {
  weekNumber: number;
  label: string;
  startDate: Date;
  endDate: Date;
}

function getWeeksForMonth(year: number, month: number): WeekSegment[] {
  const { lastDay } = getMonthRange(year, month);
  const weeks: WeekSegment[] = [];
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const mName = monthNames[month - 1];

  let currentStartDay = 1;
  let weekIndex = 1;

  while (currentStartDay <= lastDay) {
    const currentEndDay = Math.min(currentStartDay + 6, lastDay);
    const startDate = new Date(Date.UTC(year, month - 1, currentStartDay, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month - 1, currentEndDay, 23, 59, 59, 999));

    const startPad = String(currentStartDay).padStart(2, "0");
    const endPad = String(currentEndDay).padStart(2, "0");

    weeks.push({
      weekNumber: weekIndex,
      label: `Week ${weekIndex} (${startPad} ${mName} - ${endPad} ${mName})`,
      startDate,
      endDate,
    });

    currentStartDay += 7;
    weekIndex++;
  }

  return weeks;
}

/**
 * GET /admin/targets/overview
 * Comprehensive data endpoint for either AMOUNT or LEAD target category
 * supporting Yearly, Quarterly (Q1-Q4), Monthly (M1-M12), and Weekly views.
 */
export async function getTargetOverview(req: Request, res: Response): Promise<void> {
  if (!assertAdmin(req, res)) return;

  try {
    const category = (req.query.category as TargetCategory) || TargetCategory.AMOUNT;
    const year = Number(req.query.year) || new Date().getFullYear();
    const scope = (req.query.scope as TargetScope) || TargetScope.COMPANY;
    const selectedMonth = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;

    // Admin can view personal targets or company targets
    const targetAccountId = scope === "INDIVIDUAL" ? req.user?.id : undefined;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1;
    const currentQuarterNum = Math.floor((now.getMonth() + 3) / 3);

    const compareYears = [year - 2, year - 1, year, year + 1];

    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    // ─────────────────────────────────────────────────────────────
    // Fetch targets, leads, and quotations across the selected year
    // in parallel with lean projection — only current year in memory!
    // ─────────────────────────────────────────────────────────────
    const leadWhere: any = {
      OR: [
        { createdAt: { gte: yearStart, lte: yearEnd } },
        {
          status: "CONVERTED",
          OR: [
            { closedAt: { gte: yearStart, lte: yearEnd } },
            { closedAt: null, createdAt: { gte: yearStart, lte: yearEnd } },
          ],
        },
      ],
    };

    if (targetAccountId) {
      leadWhere.AND = [
        {
          OR: [
            { createdBy: targetAccountId },
            { assignments: { some: { accountId: targetAccountId, isActive: true } } },
          ],
        },
      ];
    }

    const quotationWhere: any = {
      status: { in: ["ACCEPTED", "CONVERTED"] },
      quotationDate: { gte: yearStart, lte: yearEnd },
    };

    if (targetAccountId) {
      quotationWhere.OR = [
        { createdBy: targetAccountId },
        { preparedBy: targetAccountId },
      ];
    }

    const [allTargets, allLeads, allQuotations] = await Promise.all([
      prisma.target.findMany({
        where: {
          category,
          scope,
          ...(targetAccountId ? { accountId: targetAccountId } : {}),
          year: { in: compareYears },
        },
        include: {
          account: {
            select: { id: true, firstName: true, lastName: true, avatar: true },
          },
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      prisma.lead.findMany({
        where: leadWhere,
        select: {
          createdAt: true,
          closedAt: true,
          status: true,
          cost: true,
        },
      }),
      prisma.quotation.findMany({
        where: quotationWhere,
        select: {
          quotationDate: true,
          grandTotal: true,
        },
      }),
    ]);

    const yearlyTargetRecord = allTargets.find(
      (t) => t.year === year && t.periodType === TargetPeriodType.YEARLY
    );

    // ─────────────────────────────────────────────────────────────
    // 1. YEARLY METRICS
    // ─────────────────────────────────────────────────────────────
    const yearAchieve = calculateAchievementFromMemory(yearStart, yearEnd, allLeads, allQuotations);

    const yearTargetAmount = Number(yearlyTargetRecord?.targetAmount ?? 0);
    const yearAchievedAmount = yearlyTargetRecord?.manualAchievedAmount !== null &&
      yearlyTargetRecord?.manualAchievedAmount !== undefined
      ? Number(yearlyTargetRecord.manualAchievedAmount)
      : yearAchieve.realizedRevenue;

    const yearTargetCreated = yearlyTargetRecord?.targetLeadsCreated ?? 0;
    const yearAchievedCreated = yearlyTargetRecord?.manualAchievedLeadsCreated !== null &&
      yearlyTargetRecord?.manualAchievedLeadsCreated !== undefined
      ? yearlyTargetRecord.manualAchievedLeadsCreated
      : yearAchieve.leadCreated;

    const yearTargetConverted = yearlyTargetRecord?.targetLeadsConverted ?? 0;
    const yearAchievedConverted = yearlyTargetRecord?.manualAchievedLeadsConverted !== null &&
      yearlyTargetRecord?.manualAchievedLeadsConverted !== undefined
      ? yearlyTargetRecord.manualAchievedLeadsConverted
      : yearAchieve.leadConverted;

    // Time elapsed for year
    const totalDaysYear = Math.round((yearEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24));
    let elapsedDaysYear = 0;
    if (year < currentYear) elapsedDaysYear = totalDaysYear;
    else if (year === currentYear) {
      elapsedDaysYear = Math.max(1, Math.min(totalDaysYear, Math.round((now.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24))));
    }
    const timeProgressPercentYear = Math.min(100, Math.round((elapsedDaysYear / totalDaysYear) * 100));

    // Amount pacing
    const expectedAmountYearTillDate = Math.round((yearTargetAmount / totalDaysYear) * elapsedDaysYear);
    const shortfallAmountYear = yearAchievedAmount - expectedAmountYearTillDate;
    const isBehindAmountYear = shortfallAmountYear < 0;
    const lagPercentAmountYear = expectedAmountYearTillDate > 0 && isBehindAmountYear
      ? Math.round((Math.abs(shortfallAmountYear) / expectedAmountYearTillDate) * 100)
      : 0;

    // Lead pacing
    const expectedCreatedTillDate = Math.round((yearTargetCreated / totalDaysYear) * elapsedDaysYear);
    const expectedConvertedTillDate = Math.round((yearTargetConverted / totalDaysYear) * elapsedDaysYear);

    const yearlyData = {
      targetId: yearlyTargetRecord?.id || null,
      startDate: yearStart.toISOString(),
      endDate: yearEnd.toISOString(),
      totalDays: totalDaysYear,
      elapsedDays: elapsedDaysYear,
      timeProgressPercent: timeProgressPercentYear,
      amount: {
        target: yearTargetAmount,
        achieved: yearAchievedAmount,
        remaining: Math.max(0, yearTargetAmount - yearAchievedAmount),
        achievementPercent: yearTargetAmount > 0 ? Math.round((yearAchievedAmount / yearTargetAmount) * 100) : 0,
        expectedAsOnDate: expectedAmountYearTillDate,
        shortfall: shortfallAmountYear,
        isBehindPace: isBehindAmountYear,
        lagPercent: lagPercentAmountYear,
        formatted: {
          target: formatINRSummary(yearTargetAmount),
          achieved: formatINRSummary(yearAchievedAmount),
          remaining: formatINRSummary(Math.max(0, yearTargetAmount - yearAchievedAmount)),
          shortfall: formatINRSummary(Math.abs(shortfallAmountYear)),
        },
      },
      lead: {
        created: {
          target: yearTargetCreated,
          achieved: yearAchievedCreated,
          remaining: Math.max(0, yearTargetCreated - yearAchievedCreated),
          achievementPercent: yearTargetCreated > 0 ? Math.round((yearAchievedCreated / yearTargetCreated) * 100) : 0,
          expectedAsOnDate: expectedCreatedTillDate,
          isBehindPace: yearAchievedCreated < expectedCreatedTillDate,
        },
        converted: {
          target: yearTargetConverted,
          achieved: yearAchievedConverted,
          remaining: Math.max(0, yearTargetConverted - yearAchievedConverted),
          achievementPercent: yearTargetConverted > 0 ? Math.round((yearAchievedConverted / yearTargetConverted) * 100) : 0,
          expectedAsOnDate: expectedConvertedTillDate,
          isBehindPace: yearAchievedConverted < expectedConvertedTillDate,
        },
        conversionRate: yearAchievedCreated > 0 ? Math.round((yearAchievedConverted / yearAchievedCreated) * 100) : 0,
      },
    };

    // ─────────────────────────────────────────────────────────────
    // 2. QUARTERLY METRICS (Q1, Q2, Q3, Q4)
    // ─────────────────────────────────────────────────────────────
    const quartersData: any[] = [];
    const qLabels = ["Q1 (Jan - Mar)", "Q2 (Apr - Jun)", "Q3 (Jul - Sep)", "Q4 (Oct - Dec)"];

    for (let q = 1; q <= 4; q++) {
      const { startDate, endDate } = getQuarterRange(year, q);
      const isCurrent = year === currentYear && q === currentQuarterNum;
      const isCompleted = year < currentYear || (year === currentYear && q < currentQuarterNum);

      const qTargetRecord = allTargets.find(
        (t) => t.year === year && t.periodType === TargetPeriodType.QUARTERLY && t.quarter === q
      );

      const achieve = calculateAchievementFromMemory(startDate, endDate, allLeads, allQuotations);

      // Amount
      const targetAmount = Number(qTargetRecord?.targetAmount ?? (yearTargetAmount > 0 ? Math.round(yearTargetAmount / 4) : 0));
      const achievedAmount = qTargetRecord?.manualAchievedAmount !== null && qTargetRecord?.manualAchievedAmount !== undefined
        ? Number(qTargetRecord.manualAchievedAmount)
        : achieve.realizedRevenue;
      const remainingAmount = Math.max(0, targetAmount - achievedAmount);
      const percentAmount = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0;

      // Leads
      const targetCreated = qTargetRecord?.targetLeadsCreated ?? (yearTargetCreated > 0 ? Math.round(yearTargetCreated / 4) : 0);
      const achievedCreated = qTargetRecord?.manualAchievedLeadsCreated !== null && qTargetRecord?.manualAchievedLeadsCreated !== undefined
        ? qTargetRecord.manualAchievedLeadsCreated
        : achieve.leadCreated;
      const remainingCreated = Math.max(0, targetCreated - achievedCreated);
      const percentCreated = targetCreated > 0 ? Math.round((achievedCreated / targetCreated) * 100) : 0;

      const targetConverted = qTargetRecord?.targetLeadsConverted ?? (yearTargetConverted > 0 ? Math.round(yearTargetConverted / 4) : 0);
      const achievedConverted = qTargetRecord?.manualAchievedLeadsConverted !== null && qTargetRecord?.manualAchievedLeadsConverted !== undefined
        ? qTargetRecord.manualAchievedLeadsConverted
        : achieve.leadConverted;
      const remainingConverted = Math.max(0, targetConverted - achievedConverted);
      const percentConverted = targetConverted > 0 ? Math.round((achievedConverted / targetConverted) * 100) : 0;

      quartersData.push({
        quarter: q,
        name: qLabels[q - 1],
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isCurrent,
        isCompleted,
        hasExplicitTarget: !!qTargetRecord,
        targetId: qTargetRecord?.id || null,
        amount: {
          target: targetAmount,
          achieved: achievedAmount,
          remaining: remainingAmount,
          achievementPercent: percentAmount,
          formatted: {
            target: formatINRSummary(targetAmount),
            achieved: formatINRSummary(achievedAmount),
            remaining: formatINRSummary(remainingAmount),
          },
        },
        lead: {
          created: {
            target: targetCreated,
            achieved: achievedCreated,
            remaining: remainingCreated,
            achievementPercent: percentCreated,
          },
          converted: {
            target: targetConverted,
            achieved: achievedConverted,
            remaining: remainingConverted,
            achievementPercent: percentConverted,
          },
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. MONTHLY METRICS (1 to 12)
    // ─────────────────────────────────────────────────────────────
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const monthsData: any[] = [];

    for (let m = 1; m <= 12; m++) {
      const { startDate, endDate } = getMonthRange(year, m);
      const isCurrent = year === currentYear && m === currentMonthNum;
      const isCompleted = year < currentYear || (year === currentYear && m < currentMonthNum);

      const mTargetRecord = allTargets.find(
        (t) => t.year === year && t.periodType === TargetPeriodType.MONTHLY && t.month === m
      );

      const achieve = calculateAchievementFromMemory(startDate, endDate, allLeads, allQuotations);

      // Amount
      const targetAmount = Number(mTargetRecord?.targetAmount ?? (yearTargetAmount > 0 ? Math.round(yearTargetAmount / 12) : 0));
      const achievedAmount = mTargetRecord?.manualAchievedAmount !== null && mTargetRecord?.manualAchievedAmount !== undefined
        ? Number(mTargetRecord.manualAchievedAmount)
        : achieve.realizedRevenue;
      const remainingAmount = Math.max(0, targetAmount - achievedAmount);
      const percentAmount = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0;

      // Leads
      const targetCreated = mTargetRecord?.targetLeadsCreated ?? (yearTargetCreated > 0 ? Math.round(yearTargetCreated / 12) : 0);
      const achievedCreated = mTargetRecord?.manualAchievedLeadsCreated !== null && mTargetRecord?.manualAchievedLeadsCreated !== undefined
        ? mTargetRecord.manualAchievedLeadsCreated
        : achieve.leadCreated;
      const remainingCreated = Math.max(0, targetCreated - achievedCreated);
      const percentCreated = targetCreated > 0 ? Math.round((achievedCreated / targetCreated) * 100) : 0;

      const targetConverted = mTargetRecord?.targetLeadsConverted ?? (yearTargetConverted > 0 ? Math.round(yearTargetConverted / 12) : 0);
      const achievedConverted = mTargetRecord?.manualAchievedLeadsConverted !== null && mTargetRecord?.manualAchievedLeadsConverted !== undefined
        ? mTargetRecord.manualAchievedLeadsConverted
        : achieve.leadConverted;
      const remainingConverted = Math.max(0, targetConverted - achievedConverted);
      const percentConverted = targetConverted > 0 ? Math.round((achievedConverted / targetConverted) * 100) : 0;

      monthsData.push({
        month: m,
        name: monthNames[m - 1],
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isCurrent,
        isCompleted,
        hasExplicitTarget: !!mTargetRecord,
        targetId: mTargetRecord?.id || null,
        amount: {
          target: targetAmount,
          achieved: achievedAmount,
          remaining: remainingAmount,
          achievementPercent: percentAmount,
          formatted: {
            target: formatINRSummary(targetAmount),
            achieved: formatINRSummary(achievedAmount),
            remaining: formatINRSummary(remainingAmount),
          },
        },
        lead: {
          created: {
            target: targetCreated,
            achieved: achievedCreated,
            remaining: remainingCreated,
            achievementPercent: percentCreated,
          },
          converted: {
            target: targetConverted,
            achieved: achievedConverted,
            remaining: remainingConverted,
            achievementPercent: percentConverted,
          },
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. WEEKLY METRICS (For selectedMonth of the year)
    // ─────────────────────────────────────────────────────────────
    const weeksRaw = getWeeksForMonth(year, selectedMonth);
    const weeksData: any[] = [];

    // Monthly benchmark for deriving pro-rata weekly targets if not explicitly set
    const monthObj = monthsData.find((m) => m.month === selectedMonth);
    const monthTargetAmount = monthObj?.amount.target || 0;
    const monthTargetCreated = monthObj?.lead.created.target || 0;
    const monthTargetConverted = monthObj?.lead.converted.target || 0;

    for (const w of weeksRaw) {
      const isCurrent = now >= w.startDate && now <= w.endDate;
      const isCompleted = now > w.endDate;

      const wTargetRecord = allTargets.find(
        (t) =>
          t.year === year &&
          t.periodType === TargetPeriodType.WEEKLY &&
          t.month === selectedMonth &&
          t.week === w.weekNumber
      );

      const achieve = calculateAchievementFromMemory(w.startDate, w.endDate, allLeads, allQuotations);

      // Amount
      const targetAmount = Number(wTargetRecord?.targetAmount ?? (monthTargetAmount > 0 ? Math.round(monthTargetAmount / weeksRaw.length) : 0));
      const achievedAmount = wTargetRecord?.manualAchievedAmount !== null && wTargetRecord?.manualAchievedAmount !== undefined
        ? Number(wTargetRecord.manualAchievedAmount)
        : achieve.realizedRevenue;
      const remainingAmount = Math.max(0, targetAmount - achievedAmount);
      const percentAmount = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0;

      // Leads
      const targetCreated = wTargetRecord?.targetLeadsCreated ?? (monthTargetCreated > 0 ? Math.round(monthTargetCreated / weeksRaw.length) : 0);
      const achievedCreated = wTargetRecord?.manualAchievedLeadsCreated !== null && wTargetRecord?.manualAchievedLeadsCreated !== undefined
        ? wTargetRecord.manualAchievedLeadsCreated
        : achieve.leadCreated;
      const remainingCreated = Math.max(0, targetCreated - achievedCreated);
      const percentCreated = targetCreated > 0 ? Math.round((achievedCreated / targetCreated) * 100) : 0;

      const targetConverted = wTargetRecord?.targetLeadsConverted ?? (monthTargetConverted > 0 ? Math.round(monthTargetConverted / weeksRaw.length) : 0);
      const achievedConverted = wTargetRecord?.manualAchievedLeadsConverted !== null && wTargetRecord?.manualAchievedLeadsConverted !== undefined
        ? wTargetRecord.manualAchievedLeadsConverted
        : achieve.leadConverted;
      const remainingConverted = Math.max(0, targetConverted - achievedConverted);
      const percentConverted = targetConverted > 0 ? Math.round((achievedConverted / targetConverted) * 100) : 0;

      weeksData.push({
        weekNumber: w.weekNumber,
        label: w.label,
        startDate: w.startDate.toISOString(),
        endDate: w.endDate.toISOString(),
        isCurrent,
        isCompleted,
        hasExplicitTarget: !!wTargetRecord,
        targetId: wTargetRecord?.id || null,
        amount: {
          target: targetAmount,
          achieved: achievedAmount,
          remaining: remainingAmount,
          achievementPercent: percentAmount,
          formatted: {
            target: formatINRSummary(targetAmount),
            achieved: formatINRSummary(achievedAmount),
            remaining: formatINRSummary(remainingAmount),
          },
        },
        lead: {
          created: {
            target: targetCreated,
            achieved: achievedCreated,
            remaining: remainingCreated,
            achievementPercent: percentCreated,
          },
          converted: {
            target: targetConverted,
            achieved: achievedConverted,
            remaining: remainingConverted,
            achievementPercent: percentConverted,
          },
        },
      });
    }

    // Multi-year comparison for Yearly Chart & Analytics
    const otherYears = compareYears.filter((y) => y !== year);
    const otherYearMetrics = await Promise.all(
      otherYears.map(async (y) => {
        const yStart = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
        const yEnd = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
        const metrics = await calculateAchievementMetrics(yStart, yEnd, targetAccountId);
        return { y, metrics };
      })
    );
    const otherMetricsMap = new Map(otherYearMetrics.map((item) => [item.y, item.metrics]));

    const yearlyComparison = compareYears.map((y) => {
      if (y === year) {
        return {
          year: y,
          isCurrentYear: y === currentYear,
          isSelectedYear: true,
          amount: yearlyData.amount,
          lead: yearlyData.lead,
        };
      }
      const yRecord = allTargets.find(
        (t) => t.year === y && t.periodType === TargetPeriodType.YEARLY
      );
      const yAchieve = otherMetricsMap.get(y) || {
        leadCreated: 0,
        leadConverted: 0,
        realizedRevenue: 0,
      };

      const targetAmount = Number(yRecord?.targetAmount ?? 0);
      const achievedAmount =
        yRecord?.manualAchievedAmount !== null && yRecord?.manualAchievedAmount !== undefined
          ? Number(yRecord.manualAchievedAmount)
          : yAchieve.realizedRevenue;

      const targetCreated = yRecord?.targetLeadsCreated ?? 0;
      const achievedCreated =
        yRecord?.manualAchievedLeadsCreated !== null && yRecord?.manualAchievedLeadsCreated !== undefined
          ? yRecord.manualAchievedLeadsCreated
          : yAchieve.leadCreated;

      const targetConverted = yRecord?.targetLeadsConverted ?? 0;
      const achievedConverted =
        yRecord?.manualAchievedLeadsConverted !== null && yRecord?.manualAchievedLeadsConverted !== undefined
          ? yRecord.manualAchievedLeadsConverted
          : yAchieve.leadConverted;

      return {
        year: y,
        isCurrentYear: y === currentYear,
        isSelectedYear: false,
        amount: {
          target: targetAmount,
          achieved: achievedAmount,
          remaining: Math.max(0, targetAmount - achievedAmount),
          achievementPercent: targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0,
          formatted: {
            target: formatINRSummary(targetAmount),
            achieved: formatINRSummary(achievedAmount),
            remaining: formatINRSummary(Math.max(0, targetAmount - achievedAmount)),
          },
        },
        lead: {
          created: { target: targetCreated, achieved: achievedCreated },
          converted: { target: targetConverted, achieved: achievedConverted },
        },
      };
    });

    sendSuccessResponse(res, 200, "Target overview retrieved successfully", {
      category,
      year,
      scope,
      selectedMonth: {
        number: selectedMonth,
        name: monthNames[selectedMonth - 1],
      },
      currentInfo: {
        year: currentYear,
        month: currentMonthNum,
        quarter: currentQuarterNum,
      },
      yearly: yearlyData,
      yearlyComparison,
      quarterly: quartersData,
      monthly: monthsData,
      weekly: weeksData,
    });
  } catch (error: any) {
    console.error("Error in getTargetOverview:", error);
    sendErrorResponse(res, 500, error.message || "Failed to retrieve target overview");
  }
}

/**
 * POST /admin/targets/period-target
 * Fast upsert endpoint: Create or update a target for ANY period (Yearly, Quarterly, Monthly, Weekly)
 * for either Customer/Amount or Lead targets.
 */
export async function setPeriodTarget(req: Request, res: Response): Promise<void> {
  if (!assertAdmin(req, res)) return;

  try {
    const {
      category = TargetCategory.AMOUNT,
      periodType,
      year,
      quarter,
      month,
      week,
      scope = TargetScope.COMPANY,
      title,
      targetAmount,
      manualAchievedAmount,
      targetLeadsCreated,
      manualAchievedLeadsCreated,
      targetLeadsConverted,
      manualAchievedLeadsConverted,
      status = TargetStatus.ACTIVE,
    } = req.body;

    if (!periodType || !year) {
      sendErrorResponse(res, 400, "periodType and year are required");
      return;
    }

    // Determine target account ID (if scope is INDIVIDUAL, assign to current admin)
    const accountId = scope === TargetScope.INDIVIDUAL ? req.user?.id : req.body.accountId || null;

    // Calculate dates
    let startDate: Date;
    let endDate: Date;

    if (periodType === TargetPeriodType.YEARLY) {
      startDate = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    } else if (periodType === TargetPeriodType.QUARTERLY) {
      if (!quarter || quarter < 1 || quarter > 4) {
        sendErrorResponse(res, 400, "Valid quarter (1 to 4) is required for QUARTERLY targets");
        return;
      }
      const qRange = getQuarterRange(year, quarter);
      startDate = qRange.startDate;
      endDate = qRange.endDate;
    } else if (periodType === TargetPeriodType.MONTHLY) {
      if (!month || month < 1 || month > 12) {
        sendErrorResponse(res, 400, "Valid month (1 to 12) is required for MONTHLY targets");
        return;
      }
      const mRange = getMonthRange(year, month);
      startDate = mRange.startDate;
      endDate = mRange.endDate;
    } else if (periodType === TargetPeriodType.WEEKLY) {
      if (!month || !week) {
        sendErrorResponse(res, 400, "month and week are required for WEEKLY targets");
        return;
      }
      const weeks = getWeeksForMonth(year, month);
      const matchingWeek = weeks.find((w) => w.weekNumber === week);
      if (!matchingWeek) {
        sendErrorResponse(res, 400, `Week ${week} does not exist in month ${month}`);
        return;
      }
      startDate = matchingWeek.startDate;
      endDate = matchingWeek.endDate;
    } else {
      sendErrorResponse(res, 400, "Invalid periodType");
      return;
    }

    // Generated default title if not provided
    let finalTitle = title;
    if (!finalTitle) {
      const catLabel = category === TargetCategory.AMOUNT ? "Amount Target" : "Lead Target";
      if (periodType === TargetPeriodType.YEARLY) finalTitle = `${catLabel} - ${year}`;
      else if (periodType === TargetPeriodType.QUARTERLY) finalTitle = `${catLabel} - Q${quarter} ${year}`;
      else if (periodType === TargetPeriodType.MONTHLY) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        finalTitle = `${catLabel} - ${monthNames[month - 1]} ${year}`;
      } else if (periodType === TargetPeriodType.WEEKLY) {
        finalTitle = `${catLabel} - Week ${week} (M${month} ${year})`;
      }
    }

    // Check if target already exists for this exact slot
    const existing = await prisma.target.findFirst({
      where: {
        category,
        periodType,
        year,
        ...(quarter ? { quarter } : {}),
        ...(month ? { month } : {}),
        ...(week ? { week } : {}),
        scope,
        ...(accountId ? { accountId } : {}),
      },
    });

    let result;
    if (existing) {
      result = await prisma.target.update({
        where: { id: existing.id },
        data: {
          title: finalTitle,
          status,
          targetAmount: targetAmount !== undefined ? targetAmount : existing.targetAmount,
          manualAchievedAmount: manualAchievedAmount !== undefined ? manualAchievedAmount : existing.manualAchievedAmount,
          targetLeadsCreated: targetLeadsCreated !== undefined ? targetLeadsCreated : existing.targetLeadsCreated,
          manualAchievedLeadsCreated: manualAchievedLeadsCreated !== undefined ? manualAchievedLeadsCreated : existing.manualAchievedLeadsCreated,
          targetLeadsConverted: targetLeadsConverted !== undefined ? targetLeadsConverted : existing.targetLeadsConverted,
          manualAchievedLeadsConverted: manualAchievedLeadsConverted !== undefined ? manualAchievedLeadsConverted : existing.manualAchievedLeadsConverted,
          updatedById: req.user?.id,
        },
      });
    } else {
      result = await prisma.target.create({
        data: {
          title: finalTitle,
          category,
          periodType,
          scope,
          status,
          startDate,
          endDate,
          year,
          quarter: quarter || null,
          month: month || null,
          week: week || null,
          targetAmount: targetAmount || 0,
          manualAchievedAmount: manualAchievedAmount || null,
          targetLeadsCreated: targetLeadsCreated || null,
          manualAchievedLeadsCreated: manualAchievedLeadsCreated || null,
          targetLeadsConverted: targetLeadsConverted || null,
          manualAchievedLeadsConverted: manualAchievedLeadsConverted || null,
          accountId: accountId || null,
          createdById: ((req.user as any)?.id || (req.user as any)?.accountId || "") as string,
        },
      });
    }

    sendSuccessResponse(res, 200, "Period target set successfully", result);
  } catch (error: any) {
    console.error("Error in setPeriodTarget:", error);
    sendErrorResponse(res, 500, error.message || "Failed to set period target");
  }
}

/**
 * Standard Target CRUD Operations
 */
export async function createTarget(req: Request, res: Response): Promise<void> {
  if (!assertAdmin(req, res)) return;

  try {
    const {
      title,
      description,
      category = TargetCategory.AMOUNT,
      periodType,
      scope = TargetScope.COMPANY,
      startDate,
      endDate,
      year,
      fiscalYear,
      quarter,
      month,
      week,
      targetAmount = 0,
      manualAchievedAmount,
      targetLeadsCreated,
      manualAchievedLeadsCreated,
      targetLeadsConverted,
      manualAchievedLeadsConverted,
      teamId,
      accountId,
    } = req.body;

    if (!title || !periodType || !startDate || !endDate || !year) {
      sendErrorResponse(res, 400, "title, periodType, startDate, endDate, and year are required");
      return;
    }

    const assignedAccountId = scope === TargetScope.INDIVIDUAL ? (accountId || req.user?.id) : accountId || null;

    const target = await prisma.target.create({
      data: {
        title,
        description,
        category,
        periodType,
        scope,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        year: Number(year),
        fiscalYear,
        quarter: quarter ? Number(quarter) : null,
        month: month ? Number(month) : null,
        week: week ? Number(week) : null,
        targetAmount,
        manualAchievedAmount: manualAchievedAmount !== undefined ? manualAchievedAmount : null,
        targetLeadsCreated: targetLeadsCreated ? Number(targetLeadsCreated) : null,
        manualAchievedLeadsCreated: manualAchievedLeadsCreated !== undefined ? manualAchievedLeadsCreated : null,
        targetLeadsConverted: targetLeadsConverted ? Number(targetLeadsConverted) : null,
        manualAchievedLeadsConverted: manualAchievedLeadsConverted !== undefined ? manualAchievedLeadsConverted : null,
        teamId: teamId || null,
        accountId: assignedAccountId,
        createdById: ((req.user as any)?.id || (req.user as any)?.accountId || "") as string,
      },
    });

    sendSuccessResponse(res, 201, "Target created successfully", target);
  } catch (error: any) {
    console.error("Error creating target:", error);
    sendErrorResponse(res, 500, error.message || "Failed to create target");
  }
}

export async function updateTarget(req: Request, res: Response): Promise<void> {
  if (!assertAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const existing = await prisma.target.findUnique({ where: { id } });
    if (!existing) {
      sendErrorResponse(res, 404, "Target not found");
      return;
    }

    const {
      title,
      description,
      category,
      periodType,
      scope,
      status,
      startDate,
      endDate,
      year,
      fiscalYear,
      quarter,
      month,
      week,
      targetAmount,
      manualAchievedAmount,
      targetLeadsCreated,
      manualAchievedLeadsCreated,
      targetLeadsConverted,
      manualAchievedLeadsConverted,
      teamId,
      accountId,
    } = req.body;

    const updated = await prisma.target.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(periodType !== undefined ? { periodType } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(endDate ? { endDate: new Date(endDate) } : {}),
        ...(year ? { year: Number(year) } : {}),
        ...(fiscalYear !== undefined ? { fiscalYear } : {}),
        ...(quarter !== undefined ? { quarter: quarter ? Number(quarter) : null } : {}),
        ...(month !== undefined ? { month: month ? Number(month) : null } : {}),
        ...(week !== undefined ? { week: week ? Number(week) : null } : {}),
        ...(targetAmount !== undefined ? { targetAmount } : {}),
        ...(manualAchievedAmount !== undefined ? { manualAchievedAmount } : {}),
        ...(targetLeadsCreated !== undefined ? { targetLeadsCreated: targetLeadsCreated ? Number(targetLeadsCreated) : null } : {}),
        ...(manualAchievedLeadsCreated !== undefined ? { manualAchievedLeadsCreated } : {}),
        ...(targetLeadsConverted !== undefined ? { targetLeadsConverted: targetLeadsConverted ? Number(targetLeadsConverted) : null } : {}),
        ...(manualAchievedLeadsConverted !== undefined ? { manualAchievedLeadsConverted } : {}),
        ...(teamId !== undefined ? { teamId: teamId || null } : {}),
        ...(accountId !== undefined ? { accountId: accountId || null } : {}),
        updatedById: req.user?.id,
      },
    });

    sendSuccessResponse(res, 200, "Target updated successfully", updated);
  } catch (error: any) {
    console.error("Error updating target:", error);
    sendErrorResponse(res, 500, error.message || "Failed to update target");
  }
}

export async function deleteTarget(req: Request, res: Response): Promise<void> {
  if (!assertAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const existing = await prisma.target.findUnique({ where: { id } });
    if (!existing) {
      sendErrorResponse(res, 404, "Target not found");
      return;
    }

    await prisma.target.delete({ where: { id } });
    sendSuccessResponse(res, 200, "Target deleted successfully");
  } catch (error: any) {
    console.error("Error deleting target:", error);
    sendErrorResponse(res, 500, error.message || "Failed to delete target");
  }
}

export async function listTargets(req: Request, res: Response): Promise<void> {
  if (!assertAdmin(req, res)) return;

  try {
    const {
      category,
      periodType,
      year,
      status,
      scope,
      search,
      page = 1,
      limit = 100,
    } = req.query;

    const where: any = {};
    if (category) where.category = category as TargetCategory;
    if (periodType) where.periodType = periodType as TargetPeriodType;
    if (year) where.year = Number(year);
    if (status) where.status = status as TargetStatus;
    if (scope) where.scope = scope as TargetScope;
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: "insensitive" } },
        { description: { contains: String(search), mode: "insensitive" } },
      ];
    }

    const take = Math.min(200, Math.max(1, Number(limit) || 100));
    const skip = (Math.max(1, Number(page)) - 1) * take;

    const [total, targets] = await Promise.all([
      prisma.target.count({ where }),
      prisma.target.findMany({
        where,
        take,
        skip,
        orderBy: [{ year: "desc" }, { periodType: "asc" }, { createdAt: "desc" }],
        include: {
          team: { select: { id: true, name: true } },
          account: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    sendSuccessResponse(res, 200, "Targets list retrieved successfully", {
      total,
      page: Number(page),
      limit: take,
      targets,
    });
  } catch (error: any) {
    console.error("Error listing targets:", error);
    sendErrorResponse(res, 500, error.message || "Failed to list targets");
  }
}

export async function getTargetDetails(req: Request, res: Response): Promise<void> {
  if (!assertAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const target = await prisma.target.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        account: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!target) {
      sendErrorResponse(res, 404, "Target not found");
      return;
    }

    const achieve = await calculateAchievementMetrics(target.startDate, target.endDate, target.accountId || undefined);

    sendSuccessResponse(res, 200, "Target details retrieved successfully", {
      ...target,
      achievedMetrics: achieve,
    });
  } catch (error: any) {
    console.error("Error getting target details:", error);
    sendErrorResponse(res, 500, error.message || "Failed to get target details");
  }
}
