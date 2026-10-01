import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.config";

function buildLeadConditions(params: {
  fromDate?: any;
  toDate?: any;
  accountId?: any;
  status?: any;
  source?: any;
  productTitle?: any;
}): Prisma.Sql[] {
  const { fromDate, toDate, accountId, status, source, productTitle } = params;
  const conditions: Prisma.Sql[] = [Prisma.sql`l."isActive" = true`];

  if (fromDate) {
    conditions.push(Prisma.sql`l."createdAt" >= ${new Date(fromDate as string)}`);
  }
  if (toDate) {
    const to = new Date(toDate as string);
    to.setUTCHours(23, 59, 59, 999);
    conditions.push(Prisma.sql`l."createdAt" <= ${to}`);
  }
  if (status) {
    conditions.push(Prisma.sql`l.status::text = ${status as string}`);
  }
  if (source) {
    conditions.push(Prisma.sql`l.source::text = ${source as string}`);
  }
  if (productTitle) {
    conditions.push(Prisma.sql`l."productTitle" ILIKE ${`%${productTitle}%`}`);
  }
  if (accountId) {
    const aid = String(accountId);
    conditions.push(Prisma.sql`(
      l."createdBy" = ${aid}
      OR EXISTS (SELECT 1 FROM "LeadAssignment" a WHERE a."leadId" = l.id AND a."accountId" = ${aid} AND a."isActive" = true)
      OR EXISTS (SELECT 1 FROM "LeadHelper" h WHERE h."leadId" = l.id AND h."accountId" = ${aid} AND h."isActive" = true)
    )`);
  }

  return conditions;
}

export const getLeadAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromDate, toDate, accountId, status, source, productTitle } = req.query;

    const conditions = buildLeadConditions({
      fromDate,
      toDate,
      accountId,
      status,
      source,
      productTitle,
    });

    const whereSql = Prisma.join(conditions, " AND ");

    // ─────────────────────────────────────────────────────────────
    // Run all database-level aggregations concurrently in parallel.
    // Zero raw lead rows are pulled over the wire into Node.js.
    // ─────────────────────────────────────────────────────────────
    const [
      summaryRows,
      statusRows,
      sourceRows,
      productRows,
      createdTrendsRows,
      convertedTrendsRows,
      topAssignedRows,
      followUpRows,
      accounts,
    ] = await Promise.all([
      // 1. Overall KPIs
      prisma.$queryRaw<Array<{
        totalLeads: number;
        totalConverted: number;
        totalValue: number;
        avgConversionDays: number | null;
        totalWorkSeconds: number;
        totalDemosScheduled: number;
        totalDemosDone: number;
        importantCount: number;
        workingCount: number;
      }>>`
        SELECT 
          COUNT(*)::int AS "totalLeads",
          COUNT(*) FILTER (WHERE l.status::text = 'CONVERTED')::int AS "totalConverted",
          COALESCE(SUM(l.cost) FILTER (WHERE l.status::text = 'CONVERTED'), 0)::float AS "totalValue",
          AVG(EXTRACT(EPOCH FROM (l."closedAt" - l."createdAt")) / 86400) FILTER (WHERE l.status::text = 'CONVERTED' AND l."closedAt" IS NOT NULL AND l."closedAt" >= l."createdAt")::float AS "avgConversionDays",
          COALESCE(SUM(l."totalWorkSeconds"), 0)::int AS "totalWorkSeconds",
          COUNT(*) FILTER (WHERE l."demoScheduledAt" IS NOT NULL)::int AS "totalDemosScheduled",
          COUNT(*) FILTER (WHERE l."demoDoneAt" IS NOT NULL)::int AS "totalDemosDone",
          COUNT(*) FILTER (WHERE l."isImportant" = true)::int AS "importantCount",
          COUNT(*) FILTER (WHERE l."isWorking" = true)::int AS "workingCount"
        FROM "Lead" l
        WHERE ${whereSql}
      `,

      // 2. Status breakdown
      prisma.$queryRaw<Array<{ status: string; count: number }>>`
        SELECT l.status::text AS status, COUNT(*)::int AS count
        FROM "Lead" l
        WHERE ${whereSql}
        GROUP BY l.status
      `,

      // 3. Source breakdown
      prisma.$queryRaw<Array<{ source: string; count: number }>>`
        SELECT l.source::text AS source, COUNT(*)::int AS count
        FROM "Lead" l
        WHERE ${whereSql}
        GROUP BY l.source
      `,

      // 4. Products breakdown
      prisma.$queryRaw<Array<{
        name: string;
        count: number;
        value: number;
        convertedCount: number;
        convertedValue: number;
      }>>`
        SELECT 
          l."productTitle" AS name,
          COUNT(*)::int AS count,
          COALESCE(SUM(l.cost), 0)::float AS value,
          COUNT(*) FILTER (WHERE l.status::text = 'CONVERTED')::int AS "convertedCount",
          COALESCE(SUM(l.cost) FILTER (WHERE l.status::text = 'CONVERTED'), 0)::float AS "convertedValue"
        FROM "Lead" l
        WHERE ${whereSql}
          AND l."productTitle" IS NOT NULL AND l."productTitle" != ''
        GROUP BY l."productTitle"
        ORDER BY value DESC
      `,

      // 5. Monthly created trends
      prisma.$queryRaw<Array<{ month: string; count: number }>>`
        SELECT TO_CHAR(l."createdAt", 'YYYY-MM') AS month, COUNT(*)::int AS count
        FROM "Lead" l
        WHERE ${whereSql}
        GROUP BY 1
        ORDER BY 1
      `,

      // 6. Monthly converted trends
      prisma.$queryRaw<Array<{ month: string; count: number }>>`
        SELECT TO_CHAR(l."closedAt", 'YYYY-MM') AS month, COUNT(*)::int AS count
        FROM "Lead" l
        WHERE ${whereSql}
          AND l.status::text = 'CONVERTED' AND l."closedAt" IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `,

      // 7. Top assigned employees
      prisma.$queryRaw<Array<{
        accountId: string;
        count: number;
        converted: number;
        valueGenerated: number;
      }>>`
        SELECT 
          la."accountId" AS "accountId",
          COUNT(DISTINCT l.id)::int AS count,
          COUNT(DISTINCT CASE WHEN l.status::text = 'CONVERTED' THEN l.id END)::int AS converted,
          COALESCE(SUM(CASE WHEN l.status::text = 'CONVERTED' THEN l.cost ELSE 0 END), 0)::float AS "valueGenerated"
        FROM "LeadAssignment" la
        JOIN "Lead" l ON la."leadId" = l.id
        WHERE la."isActive" = true
          AND la."accountId" IS NOT NULL
          AND ${whereSql}
        GROUP BY la."accountId"
        ORDER BY "valueGenerated" DESC
      `,

      // 8. Follow-up metrics
      prisma.$queryRaw<Array<{
        ownerId: string;
        done: number;
        missed: number;
        pending: number;
      }>>`
        SELECT 
          COALESCE(fu."doneBy", fu."createdBy") AS "ownerId",
          COUNT(*) FILTER (WHERE fu.status::text = 'DONE')::int AS done,
          COUNT(*) FILTER (WHERE fu.status::text = 'MISSED')::int AS missed,
          COUNT(*) FILTER (WHERE fu.status::text IN ('PENDING', 'RESCHEDULED'))::int AS pending
        FROM "LeadFollowUp" fu
        JOIN "Lead" l ON fu."leadId" = l.id
        WHERE ${whereSql}
          AND COALESCE(fu."doneBy", fu."createdBy") IS NOT NULL
        GROUP BY 1
        ORDER BY missed DESC
      `,

      // 9. Accounts for O(1) names & avatars
      prisma.account.findMany({
        select: { id: true, firstName: true, lastName: true, avatar: true },
      }),
    ]);

    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    // ─────────────────────────────────────────────────────────────
    // Format KPIs
    // ─────────────────────────────────────────────────────────────
    const s = summaryRows[0] || {
      totalLeads: 0,
      totalConverted: 0,
      totalValue: 0,
      avgConversionDays: 0,
      totalWorkSeconds: 0,
      totalDemosScheduled: 0,
      totalDemosDone: 0,
      importantCount: 0,
      workingCount: 0,
    };
    const totalLeads = Number(s.totalLeads || 0);
    const totalConverted = Number(s.totalConverted || 0);
    const totalValue = Number(s.totalValue || 0);
    const winRate = totalLeads > 0 ? (totalConverted / totalLeads) * 100 : 0;

    const summary = {
      totalLeads,
      totalConverted,
      winRate: Math.round(winRate * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      avgConversionDays: Math.round(Number(s.avgConversionDays || 0) * 10) / 10,
      totalWorkSeconds: Number(s.totalWorkSeconds || 0),
      totalDemosScheduled: Number(s.totalDemosScheduled || 0),
      totalDemosDone: Number(s.totalDemosDone || 0),
      importantCount: Number(s.importantCount || 0),
      workingCount: Number(s.workingCount || 0),
    };

    // ─────────────────────────────────────────────────────────────
    // Format Status & Funnel
    // ─────────────────────────────────────────────────────────────
    const funnelStages = {
      PENDING: 0,
      IN_PROGRESS: 0,
      FOLLOW_UPS: 0,
      DEMO_DONE: 0,
      INTERESTED: 0,
      CONVERTED: 0,
      CLOSED: 0,
      ON_HOLD: 0,
    };

    const statusBreakdown: Record<string, number> = {};
    for (const row of statusRows) {
      statusBreakdown[row.status] = row.count;
      if (funnelStages.hasOwnProperty(row.status)) {
        funnelStages[row.status as keyof typeof funnelStages] = row.count;
      }
    }

    const cumulativeFunnel = {
      PENDING:
        funnelStages.PENDING +
        funnelStages.IN_PROGRESS +
        funnelStages.FOLLOW_UPS +
        funnelStages.DEMO_DONE +
        funnelStages.INTERESTED +
        funnelStages.CONVERTED +
        funnelStages.CLOSED +
        funnelStages.ON_HOLD,
      IN_PROGRESS:
        funnelStages.IN_PROGRESS +
        funnelStages.FOLLOW_UPS +
        funnelStages.DEMO_DONE +
        funnelStages.INTERESTED +
        funnelStages.CONVERTED,
      FOLLOW_UPS:
        funnelStages.FOLLOW_UPS +
        funnelStages.DEMO_DONE +
        funnelStages.INTERESTED +
        funnelStages.CONVERTED,
      DEMO_DONE:
        funnelStages.DEMO_DONE +
        funnelStages.INTERESTED +
        funnelStages.CONVERTED,
      INTERESTED: funnelStages.INTERESTED + funnelStages.CONVERTED,
      CONVERTED: funnelStages.CONVERTED,
    };

    // ─────────────────────────────────────────────────────────────
    // Format Sources
    // ─────────────────────────────────────────────────────────────
    const sourceBreakdown: Record<string, number> = {};
    for (const row of sourceRows) {
      sourceBreakdown[row.source] = row.count;
    }

    // ─────────────────────────────────────────────────────────────
    // Format Monthly Trends
    // ─────────────────────────────────────────────────────────────
    const trendMap: Record<string, { created: number; converted: number }> = {};
    for (const r of createdTrendsRows) {
      if (!trendMap[r.month]) trendMap[r.month] = { created: 0, converted: 0 };
      trendMap[r.month].created = r.count;
    }
    for (const r of convertedTrendsRows) {
      if (!trendMap[r.month]) trendMap[r.month] = { created: 0, converted: 0 };
      trendMap[r.month].converted = r.count;
    }
    const trends = Object.keys(trendMap)
      .sort()
      .map((month) => ({
        month,
        created: trendMap[month].created,
        converted: trendMap[month].converted,
      }));

    // ─────────────────────────────────────────────────────────────
    // Format Top Assigned & Follow Ups
    // ─────────────────────────────────────────────────────────────
    const topAssigned = topAssignedRows.map((r) => {
      const acc = accountMap.get(r.accountId);
      return {
        name: acc ? `${acc.firstName} ${acc.lastName}` : "Unknown",
        avatar: acc?.avatar || null,
        count: r.count,
        converted: r.converted,
        valueGenerated: Math.round(r.valueGenerated * 100) / 100,
      };
    });

    const followUpMetrics = followUpRows
      .map((r) => {
        const acc = accountMap.get(r.ownerId);
        return {
          name: acc ? `${acc.firstName} ${acc.lastName}` : "Unknown",
          avatar: acc?.avatar || null,
          missed: r.missed,
          done: r.done,
          pending: r.pending,
        };
      })
      .filter((f) => f.name !== "Unknown" && (f.done > 0 || f.missed > 0 || f.pending > 0));

    res.json({
      success: true,
      data: {
        summary,
        funnel: cumulativeFunnel,
        statusBreakdown: { ...funnelStages, ...statusBreakdown },
        sourceBreakdown,
        productList: productRows,
        trends,
        topAssigned,
        followUpMetrics,
      },
    });
  } catch (error) {
    console.error("Error in getLeadAnalytics:", error);
    res.status(500).json({ success: false, message: "Server error", error: String(error) });
  }
};
