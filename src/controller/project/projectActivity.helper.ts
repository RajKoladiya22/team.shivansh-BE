import { prisma } from "../../config/database.config";
import { getIo } from "../../core/utils/socket/index";

export interface LogProjectActivityParams {
  projectId: string;
  entityType?: "PROJECT" | "ATTACHMENT" | "COMMENT" | "TASK" | "LABEL" | "PIPELINE" | "PIPELINE_STEP";
  entityId?: string;
  action:
    | "CREATED"
    | "UPDATED"
    | "DELETED"
    | "ASSIGNED"
    | "UNASSIGNED"
    | "STATUS_CHANGED"
    | "PRIORITY_CHANGED"
    | "DUE_DATE_CHANGED"
    | "MOVED"
    | "COMMENTED"
    | "ATTACHMENT_ADDED"
    | "ATTACHMENT_REMOVED"
    | "COMPLETED"
    | "REOPENED"
    | "BLOCKED"
    | "UNBLOCKED"
    | "ARCHIVED"
    | "RESTORED";
  meta?: Record<string, any> | null;
  fromState?: any;
  toState?: any;
  performedBy?: string | null;
  tx?: any;
}

export async function logProjectActivity(params: LogProjectActivityParams) {
  try {
    const {
      projectId,
      entityType = "PROJECT",
      entityId = projectId,
      action,
      meta,
      fromState,
      toState,
      performedBy,
      tx,
    } = params;

    const db = tx || prisma;

    const activity = await db.activityLog.create({
      data: {
        projectId,
        entityType,
        entityId,
        action,
        meta: meta || undefined,
        fromState: fromState || undefined,
        toState: toState || undefined,
        performedBy: performedBy || null,
      },
      select: {
        id: true,
        projectId: true,
        taskId: true,
        entityType: true,
        entityId: true,
        action: true,
        meta: true,
        fromState: true,
        toState: true,
        performedBy: true,
        createdAt: true,
      },
    });

    // Enrich with performer details for instant socket emission
    let performer: any = null;
    if (performedBy) {
      performer = await prisma.account.findUnique({
        where: { id: performedBy },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
          designation: true,
        },
      });
    }

    const payload = {
      ...activity,
      performer,
    };

    // Emit live socket event
    try {
      const io = getIo();
      io.to(`project:${projectId}`).emit("project:activity:new", payload);
      io.emit("project:activity:new", payload);
    } catch (socketErr) {
      // Non-blocking socket error
    }

    return payload;
  } catch (error) {
    console.error("[logProjectActivity] Error creating activity log:", error);
    return null;
  }
}
