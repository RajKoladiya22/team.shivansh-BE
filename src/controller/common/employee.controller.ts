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
// export async function listEmployees(req: Request, res: Response) {
//   try {
//     const {
//       search,
//       teamId,
//       role,
//       designation,
//       jobType,
//       isActive = "true",
//       isBusy,
//       productCatalogId,
//       page = "1",
//       limit = "20",
//     } = req.query as Record<string, string>;

//     const pageNumber = Math.max(Number(page), 1);
//     const pageSize = Math.min(Number(limit), 100);

//     const where: any = {};

//     // Active employees only by default
//     if (isActive !== "all") {
//       where.isActive = isActive === "true";
//     }

//     if (jobType) where.jobType = jobType;
//     if (designation) {
//       where.designation = { contains: designation, mode: "insensitive" };
//     }

//     if (isBusy !== undefined) {
//       if (isBusy === "true") {
//         where.isBusy = true;
//       } else if (isBusy === "false") {
//         where.isBusy = false;
//       } else {
//         return res.status(400).json({
//           message: "isBusy must be 'true' or 'false'",
//         });
//       }
//     }

//     if (search) {
//       where.OR = [
//         { firstName: { contains: search, mode: "insensitive" } },
//         { lastName: { contains: search, mode: "insensitive" } },
//         { contactPhone: { contains: search } },
//         { contactEmail: { contains: search, mode: "insensitive" } },
//         { registerNumber: { contains: search, mode: "insensitive" } },
//       ];
//     }

//     if (teamId) {
//       where.teams = {
//         some: { teamId, isActive: true },
//       };
//     }

//     if (role) {
//       where.user = {
//         roles: {
//           has: role as any,
//         },
//       };
//     }

//     const [total, accounts] = await prisma.$transaction([
//       prisma.account.count({ where }),
//       prisma.account.findMany({
//         where,
//         skip: (pageNumber - 1) * pageSize,
//         take: pageSize,
//         orderBy: productCatalogId
//           ? { firstName: "asc" }
//           : { firstName: "asc" },
//         select: {
//           id: true,
//           registerNumber: true,
//           firstName: true,
//           lastName: true,
//           designation: true,
//           contactPhone: true,
//           contactEmail: true,
//           avatar: true,
//           isBusy: true,
//           isAvailable: true,
//           teams: {
//             where: { isActive: true },
//             select: {
//               team: { select: { id: true, name: true } },
//             },
//           },
//           productExpertise: productCatalogId
//             ? {
//               where: { productCatalogId },
//               select: {
//                 expertiseLevel: true,
//                 leadsCount: true,
//                 leadsConverted: true,
//                 demoCount: true,
//                 successRate: true,
//                 lastLeadAt: true,
//                 lastDemoAt: true,
//                 yearsOfExperience: true,
//                 skills: true,
//                 certifications: true,
//               },
//               take: 1,
//             }
//             : false,
//         },
//       }),
//     ]);

//     const data = accounts.map((a) => ({
//       id: a.id,
//       registerNumber: a.registerNumber,
//       name: `${a.firstName} ${a.lastName}`.trim(),
//       firstName: a.firstName,
//       lastName: a.lastName,
//       designation: a.designation,
//       contactPhone: a.contactPhone,
//       contactEmail: a.contactEmail,
//       avatar: a.avatar,
//       isBusy: a.isBusy,
//       isAvailable: a.isAvailable,
//       //   roles: a.user?.roles ?? [],
//       teams: a.teams.map((t) => t.team),
//     }));

//     return sendSuccessResponse(res, 200, "Employees fetched", {
//       data,
//       meta: {
//         page: pageNumber,
//         limit: pageSize,
//         total,
//         totalPages: Math.ceil(total / pageSize),
//       },
//     });
//   } catch (err: any) {
//     console.error("listEmployees error:", err);
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to fetch employees",
//     );
//   }
// }

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
      productCatalogId, // ← new
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const where: any = {};

    if (isActive !== "all") where.isActive = isActive === "true";
    if (jobType) where.jobType = jobType;
    if (designation) where.designation = { contains: designation, mode: "insensitive" };
    if (isBusy === "true") where.isBusy = true;
    else if (isBusy === "false") where.isBusy = false;
    else if (isBusy !== undefined)
      return res.status(400).json({ message: "isBusy must be 'true' or 'false'" });

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { contactPhone: { contains: search } },
        { contactEmail: { contains: search, mode: "insensitive" } },
        { registerNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    if (teamId) where.teams = { some: { teamId, isActive: true } };
    if (role) where.user = { roles: { has: role as any } };

    // When filtering by product, only return employees who have expertise recorded
    // Resolve adminProductId → real ProductCatalog.id
    let resolvedCatalogId: string | null = null;
    if (productCatalogId) {
      const catalog = await prisma.productCatalog.findFirst({
        where: {
          OR: [
            { id: productCatalogId },
            { adminProductId: productCatalogId },
          ],
        },
        select: { id: true },
      });
      resolvedCatalogId = catalog?.id ?? null;
    }

    // Use resolvedCatalogId everywhere productCatalogId was used
    // if (resolvedCatalogId) {
    //   where.productExpertise = {
    //     some: { productCatalogId: resolvedCatalogId },
    //   };
    // }

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
          bio: true,
          isAvailable: true,
          leaveRequests: {
            where: {
              status: "APPROVED",
              startDate: { lte: todayEnd },
              endDate: { gte: todayStart },
            },
            select: { id: true },
          },
          teams: {
            where: { isActive: true },
            select: { team: { select: { id: true, name: true } } },
          },
          // Only pull the specific product's expertise row when requested
          productExpertise: resolvedCatalogId
            ? {
              where: { productCatalogId: resolvedCatalogId },
              select: {
                expertiseLevel: true,
                leadsCount: true,
                leadsConverted: true,
                demoCount: true,
                successRate: true,
                lastLeadAt: true,
                lastDemoAt: true,
                yearsOfExperience: true,
                skills: true,
                certifications: true,
              },
              take: 1,
            }
            : false,
        },
      }),
    ]);

    const data = accounts
      .map((a) => {
        const expertise = resolvedCatalogId
          ? ((a as any).productExpertise?.[0] ?? null)
          : undefined;

        return {
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
          isOnLeave: (a as any).leaveRequests && (a as any).leaveRequests.length > 0,
          bio: a.bio,
          isAvailable: a.isAvailable,
          teams: a.teams.map((t) => t.team),
          // Only included when productCatalogId is in the request
          ...(resolvedCatalogId !== null && {
            expertise: expertise
              ? {
                level: expertise.expertiseLevel,
                leadsCount: expertise.leadsCount,
                leadsConverted: expertise.leadsConverted,
                demoCount: expertise.demoCount,
                successRate: expertise.successRate,
                lastLeadAt: expertise.lastLeadAt,
                lastDemoAt: expertise.lastDemoAt,
                yearsOfExperience: expertise.yearsOfExperience,
                skills: expertise.skills,
                certifications: expertise.certifications,
              }
              : null,
          }),
        };
      })
      // Sort by expertise level when filtering by product:
      // EXPERT → CAN_DEMO → LEARNING → GUIDANCE_NEEDED → NONE
      .sort((a: any, b: any) => {
        if (!resolvedCatalogId) return 0;
        const order: Record<string, number> = {
          EXPERT: 0,
          CAN_DEMO: 1,
          LEARNING: 2,
          GUIDANCE_NEEDED: 3,
          NONE: 4,
        };
        const la = order[a.expertise?.level ?? "NONE"] ?? 4;
        const lb = order[b.expertise?.level ?? "NONE"] ?? 4;
        if (la !== lb) return la - lb;
        // Secondary: more leads handled first
        return (b.expertise?.leadsCount ?? 0) - (a.expertise?.leadsCount ?? 0);
      });

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
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch employees");
  }
}


/**
 * GET /common/employees/:id
 * Employee basic profile (common access)
 */
// export async function getEmployeeById(req: Request, res: Response) {
//   try {
//     const { id } = req.params;

//     if (!id) {
//       return sendErrorResponse(res, 400, "Employee id is required");
//     }

//     const account = await prisma.account.findUnique({
//       where: { id },
//       select: {
//         id: true,
//         registerNumber: true,
//         firstName: true,
//         lastName: true,
//         designation: true,
//         jobType: true,
//         contactPhone: true,
//         contactEmail: true,
//         avatar: true,
//         bio: true,
//         address: true,
//         isBusy: true,
//         isActive: true,
//         joinedAt: true,
//         createdAt: true,

//         teams: {
//           where: { isActive: true },
//           select: {
//             role: true,
//             team: {
//               select: {
//                 id: true,
//                 name: true,
//                 description: true,
//               },
//             },
//           },
//         },
//       },
//     });

//     if (!account || !account.isActive) {
//       return sendErrorResponse(res, 404, "Employee not found");
//     }

//     const response = {
//       id: account.id,
//       registerNumber: account.registerNumber,
//       name: `${account.firstName} ${account.lastName}`.trim(),
//       firstName: account.firstName,
//       lastName: account.lastName,
//       designation: account.designation,
//       jobType: account.jobType,
//       contactPhone: account.contactPhone,
//       contactEmail: account.contactEmail,
//       avatar: account.avatar,
//       bio: account.bio,
//       address: account.address,
//       isBusy: account.isBusy,
//       joinedAt: account.joinedAt,
//       createdAt: account.createdAt,

//       teams: account.teams.map((t) => ({
//         id: t.team.id,
//         name: t.team.name,
//         description: t.team.description,
//         role: t.role, // LEAD | MEMBER | null
//       })),
//     };

//     return sendSuccessResponse(res, 200, "Employee fetched", response);
//   } catch (err: any) {
//     console.error("getEmployeeById error:", err);
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to fetch employee",
//     );
//   }
// }

export function toDateOnly(date: Date = new Date()): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

/**
 * GET /common/employees/:id
 * Employee full detail — profile + today's activity snapshot
 *
 * Today's snapshot includes:
 *  - Active lead (currently busy in)
 *  - Tasks assigned/completed today (with comments + checklist)
 *  - Leads assigned today (with status)
 *  - Today's attendance (check-in / check-out / work minutes)
 *  - Product expertise added today
 *  - Activity log summary (lead + task actions today)
 */
export async function getEmployeeById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return sendErrorResponse(res, 400, "Employee id is required");
    }

    // ── Today's UTC boundaries ─────────────────────────────────────────────
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const today = toDateOnly();

    // ── Parallel fetches ───────────────────────────────────────────────────
    const [
      account,
      todayAttendance,
      todayTaskAssignments,
      todayLeadAssignments,
      todayExpertise,
      todayLeadActivity,       // actions PERFORMED BY this employee
      todayTaskActivity,       // actions PERFORMED BY this employee
      assignedLeadActivity,    // all activity ON leads assigned to this employee
      assignedTaskActivity,    // all activity ON tasks assigned to this employee
    ] = await Promise.all([

      // 1. Base profile
      prisma.account.findUnique({
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
          isAvailable: true,
          isActive: true,
          joinedAt: true,
          createdAt: true,

          // Currently active lead (busy in)
          activeLead: {
            select: {
              id: true,
              customerName: true,
              mobileNumber: true,
              customerCompanyName: true,
              status: true,
              source: true,
              type: true,
              productTitle: true,
              isWorking: true,
            },
          },

          teams: {
            where: { isActive: true },
            select: {
              role: true,
              team: {
                select: { id: true, name: true, description: true },
              },
            },
          },
        },
      }),

      // 2. Today's attendance log
      prisma.attendanceLog.findUnique({
        where: {
          accountId_date: {
            accountId: id,
            date: today,
          },
        },
        select: {
          id: true,
          date: true,
          firstCheckIn: true,
          lastCheckOut: true,
          totalWorkMinutes: true,
          totalBreakMinutes: true,
          hasOpenSession: true,
          hasOpenBreak: true,
          status: true,
          isWFH: true,
          checkLogs: {
            orderBy: { checkedAt: "asc" },
            select: {
              id: true,
              type: true,
              checkedAt: true,
              source: true,
              breakType: true,
              sessionId: true,
            },
          },
        },
      }),

      // 3. Tasks assigned to this employee today (assignedAt today)
      //    Also include tasks where they are assignee and task was completed today
      prisma.taskAssignment.findMany({
        where: {
          accountId: id,
          assignedAt: { gte: todayStart, lte: todayEnd },
        },
        select: {
          id: true,
          assignedAt: true,
          status: true,
          note: true,
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              dueDate: true,
              completedAt: true,
              startedAt: true,
              projectId: true,
              project: {
                select: { id: true, name: true },
              },
              checklist: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  order: true,
                  completedAt: true,
                  completedBy: true,
                  assignedTo: true,
                  dueDate: true,
                },
                orderBy: { order: "asc" },
              },
              comments: {
                where: {
                  deletedAt: null,
                  createdAt: { gte: todayStart, lte: todayEnd },
                },
                select: {
                  id: true,
                  content: true,
                  visibility: true,
                  createdAt: true,
                  authorId: true,
                  author: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      avatar: true,
                    },
                  },
                },
                orderBy: { createdAt: "desc" },
              },
              labels: {
                select: {
                  label: { select: { id: true, name: true, color: true } },
                },
              },
            },
          },
        },
        orderBy: { assignedAt: "desc" },
      }),

      // 4. Leads assigned today
      prisma.leadAssignment.findMany({
        where: {
          accountId: id,
          assignedAt: { gte: todayStart, lte: todayEnd },
        },
        select: {
          id: true,
          assignedAt: true,
          isActive: true,
          remark: true,
          WorkSeconds: true,
          lead: {
            select: {
              id: true,
              customerName: true,
              mobileNumber: true,
              customerCompanyName: true,
              status: true,
              source: true,
              type: true,
              productTitle: true,
              isWorking: true,
              isImportant: true,
              nextFollowUpAt: true,
              remark: true,
            },
          },
        },
        orderBy: { assignedAt: "desc" },
      }),

      // 5. Product expertise added/updated today
      prisma.userProductExpertise.findMany({
        where: {
          userId: id,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        select: {
          id: true,
          expertiseLevel: true,
          createdAt: true,
          lastUpdatedAt: true,
          productCatalog: {
            select: {
              id: true,
              title: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),

      // 6. Lead activity log today (performed by this employee)
      prisma.leadActivityLog.findMany({
        where: {
          performedBy: id,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        select: {
          id: true,
          action: true,
          meta: true,
          createdAt: true,
          leadId: true,
          lead: {
            select: {
              id: true,
              customerName: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),

      // 7. Task activity log today (performed by this employee)
      prisma.activityLog.findMany({
        where: {
          performedBy: id,
          entityType: "TASK",
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        select: {
          id: true,
          action: true,
          entityId: true,
          meta: true,
          createdAt: true,
          taskId: true,
          task: {
            select: {
              id: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),

      // 8. All lead activity logs for leads THIS employee is assigned to (today)
      prisma.leadActivityLog.findMany({
        where: {
          createdAt: { gte: todayStart, lte: todayEnd },
          lead: {
            assignments: {
              some: {
                accountId: id,
                isActive: true,
              },
            },
          },
        },
        select: {
          id: true,
          action: true,
          meta: true,
          createdAt: true,
          leadId: true,
          performedBy: true,
          performedByAccount: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          lead: {
            select: {
              id: true,
              customerName: true,
              status: true,
              type: true,
              productTitle: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),

      // 9. All task activity logs for tasks THIS employee is assigned to (today)
      prisma.activityLog.findMany({
        where: {
          entityType: "TASK",
          createdAt: { gte: todayStart, lte: todayEnd },
          task: {
            assignments: {
              some: { accountId: id },
            },
          },
        },
        select: {
          id: true,
          action: true,
          entityId: true,
          meta: true,
          fromState: true,
          toState: true,
          createdAt: true,
          performedBy: true,
          taskId: true,
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              project: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // ── Guard ──────────────────────────────────────────────────────────────
    if (!account || !account.isActive) {
      return sendErrorResponse(res, 404, "Employee not found");
    }

    // ── Derive: tasks completed today (status = COMPLETED, completedAt today) ──
    const tasksCompletedToday = todayTaskAssignments.filter(
      (ta) =>
        ta.task.completedAt &&
        ta.task.completedAt >= todayStart &&
        ta.task.completedAt <= todayEnd
    );

    // ── Derive: checklist completion rate across today's tasks ───────────
    const allChecklistItems = todayTaskAssignments.flatMap(
      (ta) => ta.task.checklist
    );
    const checklistStats = {
      total: allChecklistItems.length,
      completed: allChecklistItems.filter((c) => c.status === "COMPLETED").length,
      pending: allChecklistItems.filter((c) => c.status === "PENDING").length,
    };

    // ── Derive: lead activity summary counts ────────────────────────────
    const leadActivitySummary = todayLeadActivity.reduce<Record<string, number>>(
      (acc, log) => {
        acc[log.action] = (acc[log.action] ?? 0) + 1;
        return acc;
      },
      {}
    );

    // ── Derive: task activity summary counts ─────────────────────────────
    const taskActivitySummary = todayTaskActivity.reduce<Record<string, number>>(
      (acc, log) => {
        acc[log.action] = (acc[log.action] ?? 0) + 1;
        return acc;
      },
      {}
    );

    // ── Derive: status-change events on assigned leads ────────────────────
    const leadStatusChangesToday = assignedLeadActivity.filter(
      (log) => log.action === "STATUS_CHANGED"
    );

    // ── Derive: group all assigned-lead activity by lead ─────────────────
    const assignedLeadActivityByLead = assignedLeadActivity.reduce<
      Record<string, typeof assignedLeadActivity>
    >((acc, log) => {
      if (!acc[log.leadId]) acc[log.leadId] = [];
      acc[log.leadId].push(log);
      return acc;
    }, {});

    // ── Derive: notable task events (status changes, assignments, blocks) ─
    const notableTaskActions = new Set([
      "STATUS_CHANGED",
      "COMPLETED",
      "REOPENED",
      "BLOCKED",
      "UNBLOCKED",
      "ASSIGNED",
      "UNASSIGNED",
      "PRIORITY_CHANGED",
      "DUE_DATE_CHANGED",
    ]);

    const assignedTaskActivityByTask = assignedTaskActivity.reduce<
      Record<string, typeof assignedTaskActivity>
    >((acc, log) => {
      const key = log.taskId ?? log.entityId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(log);
      return acc;
    }, {});

    const notableTaskActivityToday = assignedTaskActivity.filter((log) =>
      notableTaskActions.has(log.action)
    );

    // ── Attendance helpers ────────────────────────────────────────────────
    const attendance = todayAttendance
      ? {
        status: todayAttendance.status,
        firstCheckIn: todayAttendance.firstCheckIn,
        lastCheckOut: todayAttendance.lastCheckOut,
        totalWorkMinutes: todayAttendance.totalWorkMinutes,
        totalBreakMinutes: todayAttendance.totalBreakMinutes,
        hasOpenSession: todayAttendance.hasOpenSession,
        hasOpenBreak: todayAttendance.hasOpenBreak,
        isWFH: todayAttendance.isWFH,
        checkLogs: todayAttendance.checkLogs,
      }
      : null;




    // ── Compose response ──────────────────────────────────────────────────
    const response = {
      // ── Profile ──────────────────────────────────────────────────────
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
      isAvailable: account.isAvailable,
      joinedAt: account.joinedAt,
      createdAt: account.createdAt,
      teams: account.teams.map((t) => ({
        id: t.team.id,
        name: t.team.name,
        description: t.team.description,
        role: t.role,
      })),

      // ── Currently active lead ─────────────────────────────────────────
      activeLead: account.activeLead ?? null,

      // ── Today's snapshot ──────────────────────────────────────────────
      today: {
        date: todayStart,

        // Attendance
        attendance,

        // Tasks
        // tasks: {
        //   assignedToday: todayTaskAssignments.map((ta) => ({
        //     assignmentId: ta.id,
        //     assignedAt: ta.assignedAt,
        //     assignmentStatus: ta.status,
        //     note: ta.note,
        //     task: {
        //       id: ta.task.id,
        //       title: ta.task.title,
        //       status: ta.task.status,
        //       priority: ta.task.priority,
        //       dueDate: ta.task.dueDate,
        //       completedAt: ta.task.completedAt,
        //       startedAt: ta.task.startedAt,
        //       project: ta.task.project,
        //       labels: ta.task.labels.map((l) => l.label),
        //       checklist: ta.task.checklist,
        //       todayComments: ta.task.comments,
        //     },
        //   })),
        //   completedToday: tasksCompletedToday.map((ta) => ({
        //     taskId: ta.task.id,
        //     title: ta.task.title,
        //     completedAt: ta.task.completedAt,
        //     project: ta.task.project,
        //   })),
        //   summary: {
        //     totalAssignedToday: todayTaskAssignments.length,
        //     completedTodayCount: tasksCompletedToday.length,
        //     checklistStats,
        //   },
        // },

        // Leads
        leads: {
          assignedToday: todayLeadAssignments.map((la) => ({
            assignmentId: la.id,
            assignedAt: la.assignedAt,
            isActive: la.isActive,
            remark: la.remark,
            workSeconds: la.WorkSeconds,
            lead: la.lead,
          })),
          summary: {
            totalAssignedToday: todayLeadAssignments.length,
            byStatus: todayLeadAssignments.reduce<Record<string, number>>(
              (acc, la) => {
                const s = la.lead.status;
                acc[s] = (acc[s] ?? 0) + 1;
                return acc;
              },
              {}
            ),
          },

          // ── NEW ──────────────────────────────────────────────────────
          activityOnAssignedLeads: {
            // All events that happened on leads assigned to this employee today
            all: assignedLeadActivity,

            // Grouped per lead — useful for a per-lead timeline in the UI
            byLead: assignedLeadActivityByLead,

            // Status changes only — demo done, in progress, closed, etc.
            statusChanges: leadStatusChangesToday.map((log) => ({
              id: log.id,
              leadId: log.leadId,
              lead: log.lead,
              action: log.action,
              // meta typically holds { from: "PENDING", to: "DEMO_DONE" } etc.
              from: (log.meta as any)?.from ?? null,
              to: (log.meta as any)?.to ?? null,
              performedBy: log.performedBy,
              performedByAccount: log.performedByAccount,
              createdAt: log.createdAt,
            })),

            summary: {
              totalEvents: assignedLeadActivity.length,
              statusChanges: leadStatusChangesToday.length,
              byAction: assignedLeadActivity.reduce<Record<string, number>>(
                (acc, log) => {
                  acc[log.action] = (acc[log.action] ?? 0) + 1;
                  return acc;
                },
                {}
              ),
            },
          },
        },

        // Tasks — replace the existing tasks block
        tasks: {
          assignedToday: todayTaskAssignments.map((ta) => ({
            assignmentId: ta.id,
            assignedAt: ta.assignedAt,
            assignmentStatus: ta.status,
            note: ta.note,
            task: {
              id: ta.task.id,
              title: ta.task.title,
              status: ta.task.status,
              priority: ta.task.priority,
              dueDate: ta.task.dueDate,
              completedAt: ta.task.completedAt,
              startedAt: ta.task.startedAt,
              project: ta.task.project,
              labels: ta.task.labels.map((l) => l.label),
              checklist: ta.task.checklist,
              todayComments: ta.task.comments,
            },
          })),
          completedToday: tasksCompletedToday.map((ta) => ({
            taskId: ta.task.id,
            title: ta.task.title,
            completedAt: ta.task.completedAt,
            project: ta.task.project,
          })),
          summary: {
            totalAssignedToday: todayTaskAssignments.length,
            completedTodayCount: tasksCompletedToday.length,
            checklistStats,
          },

          // ── NEW ──────────────────────────────────────────────────────
          activityOnAssignedTasks: {
            // All events on tasks this employee is assigned to
            all: assignedTaskActivity,

            // Grouped per task — useful for per-task timeline
            byTask: assignedTaskActivityByTask,

            // Only notable events (status changes, blocks, priority shifts, etc.)
            notable: notableTaskActivityToday.map((log) => ({
              id: log.id,
              taskId: log.taskId ?? log.entityId,
              task: log.task,
              action: log.action,
              from: (log.fromState as any) ?? null,
              to: (log.toState as any) ?? null,
              meta: log.meta,
              performedBy: log.performedBy,
              createdAt: log.createdAt,
            })),

            summary: {
              totalEvents: assignedTaskActivity.length,
              notableEvents: notableTaskActivityToday.length,
              byAction: assignedTaskActivity.reduce<Record<string, number>>(
                (acc, log) => {
                  acc[log.action] = (acc[log.action] ?? 0) + 1;
                  return acc;
                },
                {}
              ),
            },
          },
        },

        // Expertise added today
        expertiseAdded: {
          count: todayExpertise.length,
          items: todayExpertise,
        },

        // Activity logs
        activityLog: {
          leadActivity: todayLeadActivity,
          taskActivity: todayTaskActivity,
          summary: {
            totalLeadActions: todayLeadActivity.length,
            totalTaskActions: todayTaskActivity.length,
            leadActionBreakdown: leadActivitySummary,
            taskActionBreakdown: taskActivitySummary,
          },
        },
      },
    };

    return sendSuccessResponse(res, 200, "Employee fetched", response);
  } catch (err: any) {
    console.error("getEmployeeById error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch employee"
    );
  }
}