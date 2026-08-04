import path from "path";
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* =========================================================
   HELPERS
========================================================= */

async function getAccountIdFromReqUser(user: any): Promise<string | null> {
  if (user?.accountId) return user.accountId;
  if (user?.id) {
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      select: { accountId: true },
    });
    return u?.accountId || null;
  }
  return null;
}

function formatCustomFields(fields: any[]) {
  if (!Array.isArray(fields)) return [];
  return fields.map((cf) => {
    let opts = cf.options;
    let val = cf.value ?? null;
    if (opts && typeof opts === "object" && !Array.isArray(opts)) {
      val = opts.value ?? val;
      opts = opts.options ?? opts.list ?? null;
    }
    return {
      ...cf,
      options: opts,
      value: val,
    };
  });
}

/** Compute % tasks completed for a project */
function computeProgress(tasks: { status: string }[]): number {
  if (!tasks.length) return 0;
  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  return Math.round((done / tasks.length) * 100);
}


/* =========================================================
   GET /projects  — list with pagination + filters
========================================================= */
export async function listProjects(req: Request, res: Response) {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      visibility,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, any> = {
      deletedAt: null,
      ...(status && { status }),
      ...(visibility && { visibility }),
      ...(search && {
        name: { contains: String(search), mode: "insensitive" },
      }),
    };

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          members: {
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                  designation: true,
                },
              },
            },
          },
          tasks: {
            where: { deletedAt: null },
            select: { id: true, status: true },
          },
          _count: {
            select: { tasks: true, members: true },
          },
        },
      }),
      prisma.project.count({ where }),
    ]);

    const data = projects.map((p) => ({
      ...p,
      progress: computeProgress(p.tasks),
    }));

    sendSuccessResponse(res, 200, "Projects fetched", {
      data,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("[project.controller] listProjects:", error);
    sendErrorResponse(res, 500, "Failed to fetch projects");
  }
}

/* =========================================================
   POST /projects  — create project
========================================================= */
export async function createProject(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const accountId = await getAccountIdFromReqUser(user);

    if (!accountId) {
      return sendErrorResponse(res, 401, "Account not found for authenticated user");
    }

    const {
      name,
      description,
      status = "DRAFT",
      visibility = "TEAM",
      startDate,
      endDate,
      color,
      icon,
    } = req.body;

    let members = req.body.members || [];
    if (typeof members === "string") {
      try { members = JSON.parse(members); } catch { members = []; }
    }

    let customFields = req.body.customFields || [];
    if (typeof customFields === "string") {
      try { customFields = JSON.parse(customFields); } catch { customFields = []; }
    }

    let attachments = req.body.attachments || [];
    if (typeof attachments === "string") {
      try { attachments = JSON.parse(attachments); } catch { attachments = []; }
    }

    if (!name?.trim()) {
      return sendErrorResponse(res, 400, "Project name is required");
    }

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name: name.trim(),
          description,
          status,
          visibility,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          color,
          icon,
          createdBy: accountId,
        },
      });

      // Auto-add creator as OWNER member
      await tx.projectMember.create({
        data: {
          projectId: created.id,
          accountId,
          role: "OWNER",
          addedBy: accountId,
        },
      }).catch((err) => {
        console.warn("[project.controller] Failed to auto-add creator as member:", err);
      });

      // Add additional members provided in request body (skip creator if present)
      if (Array.isArray(members) && members.length > 0) {
        for (const m of members) {
          if (!m?.accountId || m.accountId === accountId) continue;
          await tx.projectMember.create({
            data: {
              projectId: created.id,
              accountId: m.accountId,
              role: m.role || "MEMBER",
              addedBy: accountId,
            },
          }).catch((err) => {
            console.warn(`[project.controller] Skip duplicate member ${m.accountId}:`, err);
          });
        }
      }

      // Auto-create a default pipeline with 3 stages
      const pipeline = await tx.projectPipeline.create({
        data: {
          projectId: created.id,
          source: "BLANK",
        },
      });

      await tx.pipelineStep.createMany({
        data: [
          { pipelineId: pipeline.id, name: "To Do",      order: 0, isTerminal: false, wipLimit: 0 },
          { pipelineId: pipeline.id, name: "In Progress", order: 1, isTerminal: false, wipLimit: 0 },
          { pipelineId: pipeline.id, name: "Done",        order: 2, isTerminal: true,  wipLimit: 0 },
        ],
      });

      // Add custom fields if provided
      if (Array.isArray(customFields) && customFields.length > 0) {
        for (let idx = 0; idx < customFields.length; idx++) {
          const cf = customFields[idx];
          if (!cf.name || !cf.fieldType) continue;
          let optionsData = cf.options || null;
          if (cf.value !== undefined) {
            optionsData = {
              options: Array.isArray(cf.options) ? cf.options : null,
              value: cf.value,
            };
          }
          await tx.projectCustomField.create({
            data: {
              projectId: created.id,
              name: cf.name.trim(),
              fieldType: cf.fieldType,
              options: optionsData,
              order: idx,
              required: cf.required ?? false,
              isActive: cf.isActive ?? true,
            },
          }).catch((err) => {
            console.warn(`[project.controller] Skip duplicate custom field ${cf.name}:`, err);
          });
        }
      }

      // Add attachments passed as JSON objects if provided
      if (Array.isArray(attachments) && attachments.length > 0) {
        for (const att of attachments) {
          if (!att?.name || !att?.url) continue;
          await tx.projectAttachment.create({
            data: {
              projectId: created.id,
              name: att.name,
              source: "UPLOAD",
              url: att.url,
              mimeType: att.mimeType || null,
              sizeBytes: att.sizeBytes ? Number(att.sizeBytes) : null,
              uploadedBy: accountId,
            },
          }).catch((err) => {
            console.warn(`[project.controller] Skip attachment error ${att.name}:`, err);
          });
        }
      }

      // Handle files uploaded via FormData (req.files) during project creation
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        for (const file of req.files as Express.Multer.File[]) {
          const ext = path.extname(file.originalname).replace(".", "").toLowerCase() || "other";
          const relativeUrl = `/storage/projectAttachment/${ext}/${file.filename}`;
          await tx.projectAttachment.create({
            data: {
              projectId: created.id,
              name: file.originalname,
              source: "UPLOAD",
              url: relativeUrl,
              mimeType: file.mimetype || null,
              sizeBytes: file.size ? Number(file.size) : null,
              uploadedBy: accountId,
            },
          }).catch((err) => {
            console.warn(`[project.controller] Skip file upload error ${file.originalname}:`, err);
          });
        }
      }

      // Return complete created project with relations
      return tx.project.findUnique({
        where: { id: created.id },
        include: {
          members: {
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                  designation: true,
                },
              },
            },
          },
          customFields: true,
          attachments: { where: { deletedAt: null } },
          pipeline: {
            include: {
              steps: {
                orderBy: { order: "asc" },
              },
            },
          },
        },
      });
    });

    const responseData = project
      ? {
          ...project,
          customFields: formatCustomFields(project.customFields),
        }
      : project;

    sendSuccessResponse(res, 201, "Project created successfully", responseData);
  } catch (error: any) {
    console.error("[project.controller] createProject:", error);
    sendErrorResponse(res, 500, error.message || "Failed to create project");
  }
}

/* =========================================================
   GET /projects/:id  — get detail with pipeline, members, tasks
========================================================= */
export async function getProjectById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        pipeline: {
          include: {
            steps: {
              orderBy: { order: "asc" },
              include: {
                tasks: {
                  where: { deletedAt: null },
                  orderBy: { sortOrder: "asc" },
                  include: {
                    assignments: {
                      select: {
                        id: true,
                        type: true,
                        status: true,
                        account: {
                          select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            avatar: true,
                            designation: true,
                          },
                        },
                        team: { select: { id: true, name: true } },
                      },
                    },
                    checklist: {
                      select: { id: true, title: true, status: true },
                      orderBy: { order: "asc" },
                    },
                    _count: { select: { comments: true, subTasks: true } },
                  },
                },
              },
            },
          },
        },
        members: {
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
                designation: true,
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
        tasks: {
          where: { deletedAt: null, stepId: null },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignments: {
              select: {
                id: true,
                type: true,
                status: true,
                teamId: true,
                account: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    avatar: true,
                    designation: true,
                  },
                },
                team: { select: { id: true, name: true } },
              },
            },
          },
        },
        customFields: true,
        attachments: { where: { deletedAt: null } },
        _count: {
          select: { tasks: true, members: true },
        },
      },
    });

    if (!project) {
      return sendErrorResponse(res, 404, "Project not found");
    }

    // Gather all tasks from both pipeline steps and direct tasks (no stepId) for progress
    const pipelineTasks = project.pipeline?.steps.flatMap((s) => s.tasks) ?? [];
    const allTasksForProgress = [...pipelineTasks, ...(project.tasks ?? [])];

    sendSuccessResponse(res, 200, "Project fetched", {
      ...project,
      customFields: formatCustomFields(project.customFields),
      progress: computeProgress(allTasksForProgress),
    });
  } catch (error) {
    console.error("[project.controller] getProjectById:", error);
    sendErrorResponse(res, 500, "Failed to fetch project");
  }
}

/* =========================================================
   PATCH /projects/:id  — update project
========================================================= */
export async function updateProject(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const accountId = await getAccountIdFromReqUser(user);

    const { id } = req.params;
    const existing = await prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return sendErrorResponse(res, 404, "Project not found");

    const allowedFields = [
      "name", "description", "status", "visibility",
      "startDate", "endDate", "color", "icon", "coverUrl",
    ];

    const data: Record<string, any> = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        if (f === "startDate" || f === "endDate") {
          data[f] = req.body[f] ? new Date(req.body[f]) : null;
        } else {
          data[f] = req.body[f];
        }
      }
    }

    if (data.status === "ACTIVE" && !existing.startedAt) {
      data.startedAt = new Date();
    } else if (data.status === "COMPLETED") {
      data.completedAt = new Date();
    } else if (data.status === "CANCELLED") {
      data.cancelledAt = new Date();
    }

    let members = req.body.members;
    if (typeof members === "string") {
      try { members = JSON.parse(members); } catch { members = undefined; }
    }

    let customFields = req.body.customFields;
    if (typeof customFields === "string") {
      try { customFields = JSON.parse(customFields); } catch { customFields = undefined; }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const proj = await tx.project.update({
        where: { id },
        data,
      });

      // Update members if provided
      if (Array.isArray(members)) {
        const existingMembers = await tx.projectMember.findMany({ where: { projectId: id } });
        const existingMap = new Map(existingMembers.map((m) => [m.accountId, m]));
        const targetAccountIds = new Set(members.map((m: any) => m.accountId).filter(Boolean));

        // Delete members not in target list (except OWNER)
        for (const em of existingMembers) {
          if (!targetAccountIds.has(em.accountId) && em.role !== "OWNER") {
            await tx.projectMember.delete({ where: { id: em.id } }).catch(() => {});
          }
        }

        // Upsert target members
        for (const m of members) {
          if (!m.accountId) continue;
          const em = existingMap.get(m.accountId);
          if (em) {
            if (em.role !== "OWNER" && m.role && em.role !== m.role) {
              await tx.projectMember.update({
                where: { id: em.id },
                data: { role: m.role },
              }).catch(() => {});
            }
          } else {
            await tx.projectMember.create({
              data: {
                projectId: id,
                accountId: m.accountId,
                role: m.role || "MEMBER",
                addedBy: accountId || existing.createdBy,
              },
            }).catch(() => {});
          }
        }
      }

      // Update custom fields if provided
      if (Array.isArray(customFields)) {
        await tx.projectCustomField.deleteMany({ where: { projectId: id } }).catch(() => {});
        for (let idx = 0; idx < customFields.length; idx++) {
          const cf = customFields[idx];
          if (!cf.name || !cf.fieldType) continue;
          let optionsData = cf.options || null;
          if (cf.value !== undefined) {
            optionsData = {
              options: Array.isArray(cf.options) ? cf.options : null,
              value: cf.value,
            };
          }
          await tx.projectCustomField.create({
            data: {
              projectId: id,
              name: cf.name.trim(),
              fieldType: cf.fieldType,
              options: optionsData,
              order: idx,
              required: cf.required ?? false,
              isActive: cf.isActive ?? true,
            },
          }).catch(() => {});
        }
      }

      // Upload new attachment files if provided via req.files
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        for (const file of req.files as Express.Multer.File[]) {
          const ext = path.extname(file.originalname).replace(".", "").toLowerCase() || "other";
          const relativeUrl = `/storage/projectAttachment/${ext}/${file.filename}`;
          await tx.projectAttachment.create({
            data: {
              projectId: id,
              name: file.originalname,
              source: "UPLOAD",
              url: relativeUrl,
              mimeType: file.mimetype || null,
              sizeBytes: file.size ? Number(file.size) : null,
              uploadedBy: accountId || existing.createdBy,
            },
          }).catch((err) => {
            console.warn(`[project.controller] Skip edit attachment file error ${file.originalname}:`, err);
          });
        }
      }

      return tx.project.findUnique({
        where: { id },
        include: {
          members: {
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                  designation: true,
                },
              },
            },
          },
          customFields: true,
          attachments: { where: { deletedAt: null } },
          pipeline: {
            include: {
              steps: {
                orderBy: { order: "asc" },
              },
            },
          },
        },
      });
    });

    const responseData = updated
      ? {
          ...updated,
          customFields: formatCustomFields(updated.customFields),
        }
      : updated;

    sendSuccessResponse(res, 200, "Project updated successfully", responseData);
  } catch (error: any) {
    console.error("[project.controller] updateProject:", error);
    if (error.code === "P2025") return sendErrorResponse(res, 404, "Project not found");
    sendErrorResponse(res, 500, error.message || "Failed to update project");
  }
}

/* =========================================================
   DELETE /projects/:id  — soft delete
========================================================= */
export async function deleteProject(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const accountId = await getAccountIdFromReqUser(user);

    const existing = await prisma.project.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return sendErrorResponse(res, 404, "Project not found");

    await prisma.project.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: accountId || user?.id,
        status: "ARCHIVED",
      },
    });

    sendSuccessResponse(res, 200, "Project deleted");
  } catch (error) {
    console.error("[project.controller] deleteProject:", error);
    sendErrorResponse(res, 500, "Failed to delete project");
  }
}

/* =========================================================
   POST /projects/:id/members  — add member
========================================================= */
export async function addProjectMember(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const addedByAccountId = await getAccountIdFromReqUser(user);
    const { accountId, role = "MEMBER" } = req.body;

    if (!accountId) return sendErrorResponse(res, 400, "accountId is required");

    const project = await prisma.project.findFirst({
      where: { id, deletedAt: null },
    });
    if (!project) return sendErrorResponse(res, 404, "Project not found");

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return sendErrorResponse(res, 404, "Account not found");

    const member = await prisma.projectMember.upsert({
      where: { projectId_accountId: { projectId: id, accountId } },
      create: {
        projectId: id,
        accountId,
        role,
        addedBy: addedByAccountId || user?.id,
      },
      update: { role },
      include: {
        account: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            designation: true,
          },
        },
      },
    });

    sendSuccessResponse(res, 201, "Member added", member);
  } catch (error) {
    console.error("[project.controller] addProjectMember:", error);
    sendErrorResponse(res, 500, "Failed to add member");
  }
}

/* =========================================================
   DELETE /projects/:id/members/:accountId  — remove member
========================================================= */
export async function removeProjectMember(req: Request, res: Response) {
  try {
    const { id, accountId } = req.params;

    const member = await prisma.projectMember.findUnique({
      where: { projectId_accountId: { projectId: id, accountId } },
    });
    if (!member) return sendErrorResponse(res, 404, "Member not found");
    if (member.role === "OWNER") {
      return sendErrorResponse(res, 400, "Cannot remove the project owner");
    }

    await prisma.projectMember.delete({
      where: { projectId_accountId: { projectId: id, accountId } },
    });

    sendSuccessResponse(res, 200, "Member removed");
  } catch (error) {
    console.error("[project.controller] removeProjectMember:", error);
    sendErrorResponse(res, 500, "Failed to remove member");
  }
}

/* =========================================================
   PATCH /projects/:id/members/:accountId  — update member role
========================================================= */
export async function updateProjectMember(req: Request, res: Response) {
  try {
    const { id, accountId } = req.params;
    const { role } = req.body;

    const VALID_ROLES = ["OWNER", "MANAGER", "MEMBER", "VIEWER"];
    if (!role || !VALID_ROLES.includes(role)) {
      return sendErrorResponse(res, 400, `role must be one of: ${VALID_ROLES.join(", ")}`);
    }

    const member = await prisma.projectMember.findUnique({
      where: { projectId_accountId: { projectId: id, accountId } },
    });
    if (!member) return sendErrorResponse(res, 404, "Member not found");
    if (member.role === "OWNER" && role !== "OWNER") {
      // Count remaining owners before demoting
      const ownerCount = await prisma.projectMember.count({
        where: { projectId: id, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        return sendErrorResponse(res, 400, "Cannot remove the last project owner");
      }
    }

    const updated = await prisma.projectMember.update({
      where: { projectId_accountId: { projectId: id, accountId } },
      data: { role },
      include: {
        account: {
          select: { id: true, firstName: true, lastName: true, avatar: true, designation: true },
        },
      },
    });

    sendSuccessResponse(res, 200, "Member role updated", updated);
  } catch (error) {
    console.error("[project.controller] updateProjectMember:", error);
    sendErrorResponse(res, 500, "Failed to update member role");
  }
}

/* =========================================================
   GET /projects/:id/tasks  — all tasks for a project (flat list)
========================================================= */
export async function getProjectTasks(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status, priority, assignedToAccountId, search, page = 1, limit = 50 } = req.query;

    const project = await prisma.project.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!project) return sendErrorResponse(res, 404, "Project not found");

    const where: Record<string, any> = {
      projectId: id,
      deletedAt: null,
      ...(status   && { status }),
      ...(priority && { priority }),
    };

    if (assignedToAccountId) {
      where.assignments = {
        some: { accountId: assignedToAccountId as string },
      };
    }

    if (search) {
      where.title = { contains: String(search).trim(), mode: "insensitive" };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          step: { select: { id: true, name: true, color: true } },
          assignments: {
            select: {
              id: true,
              type: true,
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
              team: { select: { id: true, name: true } },
            },
          },
          _count: { select: { comments: true, subTasks: true, checklist: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    sendSuccessResponse(res, 200, "Project tasks fetched", {
      data: tasks,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("[project.controller] getProjectTasks:", error);
    sendErrorResponse(res, 500, "Failed to fetch project tasks");
  }
}

/* =========================================================
   GET /projects/:id/stats  — stats summary
========================================================= */
export async function getProjectStats(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!project) return sendErrorResponse(res, 404, "Project not found");

    const tasks = await prisma.task.groupBy({
      by: ["status"],
      where: { projectId: id, deletedAt: null },
      _count: { _all: true },
    });

    const stats: Record<string, number> = {};
    for (const row of tasks) {
      stats[row.status] = row._count._all;
    }

    const total = Object.values(stats).reduce((s, v) => s + v, 0);
    const completed = stats["COMPLETED"] ?? 0;

    sendSuccessResponse(res, 200, "Project stats fetched", {
      total,
      completed,
      progress: total ? Math.round((completed / total) * 100) : 0,
      byStatus: stats,
    });
  } catch (error) {
    console.error("[project.controller] getProjectStats:", error);
    sendErrorResponse(res, 500, "Failed to fetch project stats");
  }
}
