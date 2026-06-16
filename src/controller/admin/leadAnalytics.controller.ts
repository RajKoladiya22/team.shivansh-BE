import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.config";

export const getLeadAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromDate, toDate, accountId, status, source, productTitle } = req.query;

    const where: Prisma.LeadWhereInput = { isActive: true };

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate as string);
      if (toDate) {
        const to = new Date(toDate as string);
        to.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    if (accountId) {
      where.OR = [
        { createdBy: accountId as string },
        { assignments: { some: { accountId: accountId as string } } },
        { leadHelpers: { some: { accountId: accountId as string } } }
      ];
    }
    if (status) where.status = status as any;
    if (source) where.source = source as any;
    if (productTitle) where.productTitle = { contains: productTitle as string, mode: "insensitive" };

    const leads = await prisma.lead.findMany({
      where,
      select: {
        id: true,
        source: true,
        status: true,
        cost: true,
        createdAt: true,
        closedAt: true,
        followUpCount: true,
        productTitle: true,
        isImportant: true,
        isWorking: true,
        demoCount: true,
        totalWorkSeconds: true,
        demoScheduledAt: true,
        demoDoneAt: true,
        followUps: {
            select: { status: true, createdBy: true, doneBy: true, type: true }
        },
        assignments: { select: { accountId: true, account: { select: { firstName: true, lastName: true, avatar: true } } } },
        leadHelpers: { select: { accountId: true, account: { select: { firstName: true, lastName: true, avatar: true } } } }
      }
    });

    let totalLeads = leads.length;
    let totalConverted = 0;
    let totalValue = 0;
    let totalWorkSeconds = 0;
    let totalDemosScheduled = 0;
    let totalDemosDone = 0;
    
    // Priorities
    let importantCount = 0;
    let workingCount = 0;

    let conversionTimes: number[] = [];

    const statusBreakdown: Record<string, number> = {};
    const sourceBreakdown: Record<string, number> = {};
    
    // For the true funnel tracking
    const funnelStages = {
      PENDING: 0,
      IN_PROGRESS: 0,
      FOLLOW_UPS: 0,
      DEMO_DONE: 0,
      INTERESTED: 0,
      CONVERTED: 0,
      CLOSED: 0
    };

    const productBreakdown: Record<string, { count: number; value: number; convertedCount: number; convertedValue: number }> = {};
    const trendMap: Record<string, { created: number; converted: number }> = {};
    
    const assignedMap: Record<string, { name: string; avatar: string | null; count: number; converted: number; valueGenerated: number }> = {};
    
    const followUpPerformanceMap: Record<string, { name: string; avatar: string | null; missed: number; done: number; pending: number }> = {};

    for (const lead of leads) {
      // Priorites
      if (lead.isImportant) importantCount++;
      if (lead.isWorking) workingCount++;

      // Demos
      if (lead.demoScheduledAt) totalDemosScheduled++;
      if (lead.demoDoneAt) totalDemosDone++;

      // Time
      totalWorkSeconds += lead.totalWorkSeconds || 0;

      // Basic aggregations
      const isConverted = lead.status === "CONVERTED";
      
      // Funnel (Assume linear progression representation, though real world might skip stages)
      // If a lead is CONVERTED, it technically passed through PENDING etc. For simplicity, we can do a cumulative waterfall or just a count per status.
      // Usually a funnel is cumulative:
      if (funnelStages.hasOwnProperty(lead.status as string)) {
        funnelStages[lead.status as keyof typeof funnelStages]++;
      } else {
        // Map other statuses or ignore
        statusBreakdown[lead.status] = (statusBreakdown[lead.status] || 0) + 1;
      }

      if (isConverted) {
        totalConverted++;
        if (lead.cost) totalValue += Number(lead.cost);
        if (lead.closedAt) {
          const daysToConvert = (lead.closedAt.getTime() - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysToConvert >= 0) conversionTimes.push(daysToConvert);
        }
      }

      // Source
      const src = lead.source || "UNKNOWN";
      sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;

      // Product (List)
      if (lead.productTitle) {
        if (!productBreakdown[lead.productTitle]) productBreakdown[lead.productTitle] = { count: 0, value: 0, convertedCount: 0, convertedValue: 0 };
        productBreakdown[lead.productTitle].count += 1;
        if (lead.cost) productBreakdown[lead.productTitle].value += Number(lead.cost);
        if (isConverted) {
            productBreakdown[lead.productTitle].convertedCount += 1;
            if (lead.cost) productBreakdown[lead.productTitle].convertedValue += Number(lead.cost);
        }
      }

      // Trends (Monthly)
      const monthStr = lead.createdAt.toISOString().slice(0, 7); // YYYY-MM
      if (!trendMap[monthStr]) trendMap[monthStr] = { created: 0, converted: 0 };
      trendMap[monthStr].created += 1;

      if (isConverted && lead.closedAt) {
        const closedMonthStr = lead.closedAt.toISOString().slice(0, 7);
        if (!trendMap[closedMonthStr]) trendMap[closedMonthStr] = { created: 0, converted: 0 };
        trendMap[closedMonthStr].converted += 1;
      }

      // Top Assigned
      for (const assignment of lead.assignments) {
        if (!assignment.accountId || !assignment.account) continue;
        const aid = assignment.accountId;
        if (!assignedMap[aid]) {
          assignedMap[aid] = {
            name: `${assignment.account.firstName} ${assignment.account.lastName}`,
            avatar: assignment.account.avatar,
            count: 0,
            converted: 0,
            valueGenerated: 0
          };
        }
        assignedMap[aid].count += 1;
        if (isConverted) {
            assignedMap[aid].converted += 1;
            if (lead.cost) assignedMap[aid].valueGenerated += Number(lead.cost);
        }
      }

      // Follow Up Analytics
      for (const fu of lead.followUps) {
         // Follow-ups are usually doneBy or createdBy. We map it to the account who was supposed to do it or did it.
         // Let's use createdBy if pending/missed, doneBy if done. Or just createdBy as owner.
         const ownerId = fu.doneBy || fu.createdBy;
         if (!ownerId) continue;

         // find name from assignments or helpers if possible, but actually we need full accounts query. 
         // For now, if we don't have name mapped from assignment, it might just show ID, but let's try to map from assignments/helpers.
         let ownerInfo = { name: "Unknown", avatar: null as string | null };
         
         const aFound = lead.assignments.find(a => a.accountId === ownerId);
         if (aFound) ownerInfo = { name: `${aFound.account?.firstName} ${aFound.account?.lastName}`, avatar: aFound.account?.avatar || null };
         else {
             const hFound = lead.leadHelpers.find(h => h.accountId === ownerId);
             if (hFound) ownerInfo = { name: `${hFound.account?.firstName} ${hFound.account?.lastName}`, avatar: hFound.account?.avatar || null };
         }

         if (!followUpPerformanceMap[ownerId]) {
            followUpPerformanceMap[ownerId] = { name: ownerInfo.name, avatar: ownerInfo.avatar, missed: 0, done: 0, pending: 0 };
         }

         if (fu.status === "DONE") followUpPerformanceMap[ownerId].done++;
         else if (fu.status === "MISSED") followUpPerformanceMap[ownerId].missed++;
         else if (fu.status === "PENDING" || fu.status === "RESCHEDULED") followUpPerformanceMap[ownerId].pending++;
      }
    }

    // Cumulative Funnel Calculation (Water-fall logic)
    // If a lead is converted, they also passed through Interested, Demo_Done, Follow_Ups, In_Progress, Pending.
    const cumulativeFunnel = {
        PENDING: funnelStages.PENDING + funnelStages.IN_PROGRESS + funnelStages.FOLLOW_UPS + funnelStages.DEMO_DONE + funnelStages.INTERESTED + funnelStages.CONVERTED + funnelStages.CLOSED,
        IN_PROGRESS: funnelStages.IN_PROGRESS + funnelStages.FOLLOW_UPS + funnelStages.DEMO_DONE + funnelStages.INTERESTED + funnelStages.CONVERTED,
        FOLLOW_UPS: funnelStages.FOLLOW_UPS + funnelStages.DEMO_DONE + funnelStages.INTERESTED + funnelStages.CONVERTED,
        DEMO_DONE: funnelStages.DEMO_DONE + funnelStages.INTERESTED + funnelStages.CONVERTED,
        INTERESTED: funnelStages.INTERESTED + funnelStages.CONVERTED,
        CONVERTED: funnelStages.CONVERTED
    };

    const avgConversionDays = conversionTimes.length > 0 ? conversionTimes.reduce((a, b) => a + b, 0) / conversionTimes.length : 0;
    const winRate = totalLeads > 0 ? (totalConverted / totalLeads) * 100 : 0;

    const trends = Object.keys(trendMap).sort().map(month => ({
      month,
      created: trendMap[month].created,
      converted: trendMap[month].converted
    }));

    const topAssigned = Object.values(assignedMap).sort((a, b) => b.valueGenerated - a.valueGenerated);
    
    const followUpMetrics = Object.values(followUpPerformanceMap).filter(f => f.name !== "Unknown" && (f.done > 0 || f.missed > 0 || f.pending > 0)).sort((a, b) => b.missed - a.missed); // Sorted by most missed

    const productList = Object.entries(productBreakdown)
      .map(([name, data]) => ({ name, count: data.count, value: data.value, convertedCount: data.convertedCount, convertedValue: data.convertedValue }))
      .sort((a, b) => b.value - a.value);

    const summary = {
      totalLeads,
      totalConverted,
      winRate: Math.round(winRate * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      avgConversionDays: Math.round(avgConversionDays * 10) / 10,
      totalWorkSeconds,
      totalDemosScheduled,
      totalDemosDone,
      importantCount,
      workingCount
    };

    res.json({
      success: true,
      data: {
        summary,
        funnel: cumulativeFunnel,
        statusBreakdown: { ...funnelStages, ...statusBreakdown },
        sourceBreakdown,
        productList,
        trends,
        topAssigned,
        followUpMetrics
      }
    });

  } catch (error) {
    console.error("Error in getLeadAnalytics:", error);
    res.status(500).json({ success: false, message: "Server error", error: String(error) });
  }
};
