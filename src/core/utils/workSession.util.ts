// src/core/utils/workSession.util.ts
import { prisma } from "../../config/database.config";
import { getIo } from "./socket";

export interface StopActiveWorkOptions {
  reason?: string;
  endTime?: Date;
  stopLead?: boolean;
  stopSupport?: boolean;
  clearAvailability?: boolean;
}

export interface StopActiveWorkResult {
  stoppedLeadIds: string[];
  stoppedSupportIds: string[];
}

/**
 * Stops all active work (Lead and Support) for a given account inside a Prisma transaction.
 * Ensures:
 * - Lead: isWorking = false, session duration accumulated, WORK_ENDED log created.
 * - Support: isWorking = false, currentWorkSessionStart = null, totalWorkSeconds accumulated, time log & activity log created.
 * - Account: isAvailable = false (if clearAvailability), isBusy = false, activeLeadId = null, busyActivityLog created.
 */
export async function stopActiveWorkForAccount(
  tx: any,
  accountId: string,
  options: StopActiveWorkOptions = {}
): Promise<StopActiveWorkResult> {
  const reason = options.reason ?? "CHECK_OUT";
  const endTime = options.endTime ?? new Date();
  const clearAvailability = options.clearAvailability ?? true;

  const stoppedLeadIds: string[] = [];
  const stoppedSupportIds: string[] = [];

  // 1. Fetch current account state
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { activeLeadId: true, isBusy: true, isAvailable: true },
  });

  if (!account) {
    return { stoppedLeadIds, stoppedSupportIds };
  }

  // 2. STOP ACTIVE LEAD WORK
  if (options.stopLead !== false) {
    const leadId = account.activeLeadId;
    if (leadId) {
      stoppedLeadIds.push(leadId);

      // Find the most recent WORK_STARTED entry for this lead by this account
      const lastStart = await tx.leadActivityLog.findFirst({
        where: {
          leadId,
          performedBy: accountId,
          action: "WORK_STARTED",
        },
        orderBy: { createdAt: "desc" },
      });

      let durationSeconds = 0;
      let startedAtIso: string | null = null;

      if (lastStart?.meta && typeof lastStart.meta === "object") {
        startedAtIso =
          (lastStart.meta as any).startedAt ??
          lastStart.createdAt.toISOString();
      } else if (lastStart?.createdAt) {
        startedAtIso = lastStart.createdAt.toISOString();
      }

      if (startedAtIso) {
        const startedAtDate = new Date(startedAtIso);
        if (!isNaN(startedAtDate.getTime())) {
          durationSeconds = Math.max(
            0,
            Math.floor((endTime.getTime() - startedAtDate.getTime()) / 1000)
          );
        }
      }

      // Log WORK_ENDED
      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "WORK_ENDED",
          performedBy: accountId,
          meta: {
            startedAt: startedAtIso,
            endedAt: endTime.toISOString(),
            durationSeconds,
            autoStopped: true,
            reason,
          },
        },
      });

      // Update Lead
      await tx.lead.update({
        where: { id: leadId },
        data: {
          totalWorkSeconds: { increment: durationSeconds },
          isWorking: false,
        },
      });
    }

    // Safety-clear any other lead where isWorking is true and account is assigned
    const danglingLeads = await tx.lead.findMany({
      where: {
        isWorking: true,
        ...(leadId ? { id: { not: leadId } } : {}),
        assignments: { some: { accountId, isActive: true } },
      },
      select: { id: true },
    });

    for (const dl of danglingLeads) {
      stoppedLeadIds.push(dl.id);
      await tx.lead.update({
        where: { id: dl.id },
        data: { isWorking: false },
      });
    }
  }

  // 3. STOP ACTIVE SUPPORT WORK
  if (options.stopSupport !== false) {
    const workingSupports = await tx.support.findMany({
      where: {
        isWorking: true,
        OR: [
          { assignments: { some: { accountId, isActive: true } } },
          { supportHelpers: { some: { accountId, isActive: true } } },
          { createdBy: accountId },
          { activityLogs: { some: { action: "TIME_LOGGED", performedBy: accountId } } },
        ],
      },
    });

    for (const sup of workingSupports) {
      stoppedSupportIds.push(sup.id);

      let addedSeconds = 0;
      if (sup.currentWorkSessionStart) {
        const diff = endTime.getTime() - new Date(sup.currentWorkSessionStart).getTime();
        addedSeconds = Math.max(0, Math.floor(diff / 1000));
      }

      await tx.support.update({
        where: { id: sup.id },
        data: {
          isWorking: false,
          currentWorkSessionStart: null,
          totalWorkSeconds: { increment: addedSeconds },
        },
      });

      if (addedSeconds > 0) {
        await tx.supportTimeLog.create({
          data: {
            supportId: sup.id,
            seconds: addedSeconds,
            loggedBy: accountId,
            remark: `Session stopped (${reason})`,
          },
        });

        await tx.supportActivityLog.create({
          data: {
            supportId: sup.id,
            action: "TIME_LOGGED",
            performedBy: accountId,
            meta: {
              event: "WORK_STOPPED",
              seconds: addedSeconds,
              reason,
            },
          },
        });
      }
    }
  }

  // 4. UPDATE ACCOUNT STATE
  const updateData: Record<string, any> = {
    isBusy: false,
    activeLeadId: null,
  };
  if (clearAvailability) {
    updateData.isAvailable = false;
  }

  await tx.account.update({
    where: { id: accountId },
    data: updateData,
  });

  if (account.isBusy) {
    await tx.busyActivityLog.create({
      data: {
        accountId,
        fromBusy: true,
        toBusy: false,
        reason,
      },
    });
  }

  return { stoppedLeadIds, stoppedSupportIds };
}

/**
 * Emits real-time socket events after transaction commits.
 */
export async function emitWorkStoppedEvents(params: {
  accountId: string;
  stoppedLeadIds: string[];
  stoppedSupportIds: string[];
  reason: string;
  isAvailable?: boolean;
}) {
  try {
    const io = getIo();

    // 1. busy:changed
    io.emit("busy:changed", {
      accountId: params.accountId,
      leadId: params.stoppedLeadIds[0] ?? null,
      isBusy: false,
      isAvailable: params.isAvailable ?? false,
      source: params.reason,
    });

    // 2. lead:patch for each stopped lead
    for (const leadId of params.stoppedLeadIds) {
      const patch = { isWorking: false, updatedAt: new Date() };
      io.to(`lead:${leadId}`).emit("lead:patch", { id: leadId, patch });
      io.to("leads:admin").emit("lead:patch", { id: leadId, patch });
      io.to(`leads:user:${params.accountId}`).emit("lead:patch", { id: leadId, patch });
    }

    // 3. support:patch for each stopped support
    for (const supportId of params.stoppedSupportIds) {
      const support = await prisma.support.findUnique({
        where: { id: supportId },
        include: {
          customer: true,
          assignments: { include: { account: true, team: true } },
          supportHelpers: { where: { isActive: true }, include: { account: true, addedByAcc: true } },
          createdByAcc: true,
        },
      });
      if (support) {
        io.to("supports:admin").emit("support:patch", { id: support.id, patch: support });
        io.to(`support:${support.id}`).emit("support:patch", { id: support.id, patch: support });
        if (support.customerId) {
          io.to(`customer:support:${support.customerId}`).emit("support:patch", { id: support.id, patch: support });
          io.to(`customer:${support.customerId}`).emit("support:patch", { id: support.id, patch: support });
        }
        if (support.createdBy) {
          io.to(`supports:user:${support.createdBy}`).emit("support:patch", { id: support.id, patch: support });
        }
        for (const a of support.assignments) {
          if (a.isActive && a.accountId && a.accountId !== support.createdBy) {
            io.to(`supports:user:${a.accountId}`).emit("support:patch", { id: support.id, patch: support });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[emitWorkStoppedEvents] Socket emit failed:", err);
  }
}
