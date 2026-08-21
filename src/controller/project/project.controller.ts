import path from "path";
import fs from "fs";
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { logProjectActivity } from "./projectActivity.helper";
import { getIo } from "../../core/utils/socket";

/* =========================================================
   HELPERS
========================================================= */

function safeEmitProject(event: string, payload: any, projectId?: string) {
  try {
    const io = getIo();
    if (!io) return;
    if (projectId) {
      io.to(`project:${projectId}`).emit(event, payload);
    }
    io.emit(event, payload);
  } catch (err) {
    // Socket not initialized in tests or background tasks
  }
}

function deletePhysicalFile(fileUrl?: string | null) {
  if (!fileUrl) return;
  const relativePath = fileUrl.startsWith("/") ? fileUrl.slice(1) : fileUrl;
  const possiblePaths = [
    path.join(process.cwd(), "src", relativePath),
    path.join(process.cwd(), "dist/src", relativePath),
    path.join(process.cwd(), relativePath),
    path.join(__dirname, "../../", relativePath),
    path.join(__dirname, "../../../", relativePath),
  ];
  for (const absolutePath of possiblePaths) {
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
        console.log(`[deletePhysicalFile] Unlinked: ${absolutePath}`);
        break;
      } catch (err) {
        console.warn(`[deletePhysicalFile] Failed to unlink ${absolutePath}:`, err);
      }
    }
  }
}

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
      createdBy,
      createdFrom,
      createdTo,
      completedFrom,
      completedTo,
      priority,
      projectType,
      projectSource,
      onWork,
      unlinkedOnly,
      leadId,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const user = (req as any).user;
    const accountId = await getAccountIdFromReqUser(user);
    const isAdmin = Boolean(
      user?.role === "ADMIN" ||
      user?.roles?.includes("ADMIN") ||
      user?.roles?.includes("SUPER_ADMIN") ||
      user?.isSuperAdmin
    );

    const accessWhere = isAdmin
      ? {}
      : {
        OR: [
          { visibility: "PUBLIC" },
          { visibility: "TEAM" },
          {
            visibility: "PRIVATE",
            OR: [
              ...(accountId ? [{ createdBy: accountId }] : []),
              ...(user?.id ? [{ createdBy: user.id }] : []),
              ...(accountId ? [{ members: { some: { accountId } } }] : []),
            ],
          },
        ],
      };

    const leadFilter =
      String(unlinkedOnly) === "true" || leadId === "null" || leadId === "unlinked"
        ? { leadId: null }
        : leadId
        ? { leadId: String(leadId) }
        : {};

    const where: Record<string, any> = {
      deletedAt: null,
      ...accessWhere,
      ...leadFilter,
      ...(status && { status }),
      ...(visibility && { visibility }),
      ...(createdBy && { createdBy: String(createdBy) }),
      ...(String(priority) === "true" ? { priority: true } : String(priority) === "false" ? { priority: false } : {}),
      ...(projectType ? { projectType: projectType as any } : {}),
      ...(projectSource && projectSource !== "ALL" && projectSource !== "all"
        ? { projectSource: String(projectSource).toUpperCase() === "OUTSOURCE" ? "OUTSOURCE" : "INHOUSE" }
        : {}),
      ...(String(onWork) === "true" ? { onWork: true } : String(onWork) === "false" ? { onWork: false } : {}),
      ...(search && {
        name: { contains: String(search), mode: "insensitive" },
      }),
    };

    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) {
        const d = new Date(createdFrom as string);
        d.setHours(0, 0, 0, 0);
        where.createdAt.gte = d;
      }
      if (createdTo) {
        const d = new Date(createdTo as string);
        d.setHours(23, 59, 59, 999);
        where.createdAt.lte = d;
      }
    }

    if (completedFrom || completedTo) {
      where.completedAt = {};
      if (completedFrom) {
        const d = new Date(completedFrom as string);
        d.setHours(0, 0, 0, 0);
        where.completedAt.gte = d;
      }
      if (completedTo) {
        const d = new Date(completedTo as string);
        d.setHours(23, 59, 59, 999);
        where.completedAt.lte = d;
      }
    }

    const baseWhere: Record<string, any> = {
        deletedAt: null,
        ...accessWhere,
        ...leadFilter,
        ...(visibility && { visibility }),
        ...(createdBy && { createdBy: String(createdBy) }),
        ...(String(priority) === "true" ? { priority: true } : String(priority) === "false" ? { priority: false } : {}),
        ...(projectType ? { projectType: projectType as any } : {}),
        ...(projectSource && projectSource !== "ALL" && projectSource !== "all"
          ? { projectSource: String(projectSource).toUpperCase() === "OUTSOURCE" ? "OUTSOURCE" : "INHOUSE" }
          : {}),
        ...(String(onWork) === "true" ? { onWork: true } : String(onWork) === "false" ? { onWork: false } : {}),
        ...(search && {
          name: { contains: String(search), mode: "insensitive" },
        }),
      };

      if (createdFrom || createdTo) {
        baseWhere.createdAt = {};
        if (createdFrom) {
          const d = new Date(createdFrom as string);
          d.setHours(0, 0, 0, 0);
          baseWhere.createdAt.gte = d;
        }
        if (createdTo) {
          const d = new Date(createdTo as string);
          d.setHours(23, 59, 59, 999);
          baseWhere.createdAt.lte = d;
        }
      }

      if (completedFrom || completedTo) {
        baseWhere.completedAt = {};
        if (completedFrom) {
          const d = new Date(completedFrom as string);
          d.setHours(0, 0, 0, 0);
          baseWhere.completedAt.gte = d;
        }
        if (completedTo) {
          const d = new Date(completedTo as string);
          d.setHours(23, 59, 59, 999);
          baseWhere.completedAt.lte = d;
        }
      }

      const STATUS_PRIORITY: Record<string, number> = {
        ACTIVE: 1,
        ON_HOLD: 2,
        DRAFT: 3,
        COMPLETED: 4,
        CANCELLED: 5,
        ARCHIVED: 6,
      };

      const [allMatchingProjects, statusCountsRaw] = await Promise.all([
        prisma.project.findMany({
          where,
          select: { id: true, status: true, createdAt: true, endDate: true, completedAt: true, priority: true, onWork: true },
        }),
        prisma.project.groupBy({
          by: ["status"],
          where: baseWhere,
          _count: { _all: true },
        }),
      ]);

      const statusCounts: Record<string, number> = {
        DRAFT: 0,
        ACTIVE: 0,
        ON_HOLD: 0,
        COMPLETED: 0,
        CANCELLED: 0,
        ARCHIVED: 0,
      };
      for (const sc of statusCountsRaw) {
        statusCounts[sc.status] = sc._count._all;
      }

      allMatchingProjects.sort((a, b) => {
        const pA = STATUS_PRIORITY[a.status] ?? 99;
        const pB = STATUS_PRIORITY[b.status] ?? 99;
        if (pA !== pB) return pA - pB;

        // Show Priority projects first, then On Work projects first
        if (a.priority !== b.priority) {
          return (b.priority ? 1 : 0) - (a.priority ? 1 : 0);
        }
        if (a.onWork !== b.onWork) {
          return (b.onWork ? 1 : 0) - (a.onWork ? 1 : 0);
        }

        if (a.status === "COMPLETED") {
          if (a.completedAt && b.completedAt) {
            return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
          }
          if (a.completedAt) return -1;
          if (b.completedAt) return 1;
        } else {
          if (a.endDate && b.endDate) {
            return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
          }
          if (a.endDate) return -1;
          if (b.endDate) return 1;
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      const total = allMatchingProjects.length;
      const pageIds = allMatchingProjects
        .slice(skip, skip + Number(limit))
        .map((p) => p.id);

      const projectsUnordered =
        pageIds.length > 0
          ? await prisma.project.findMany({
            where: { id: { in: pageIds } },
            include: {
              lead: {
                select: {
                  id: true,
                  customerName: true,
                  mobileNumber: true,
                  customerCompanyName: true,
                  productTitle: true,
                  cost: true,
                  status: true,
                },
              },
              customer: {
                select: {
                  id: true,
                  name: true,
                  customerCompanyName: true,
                  mobile: true,
                  email: true,
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
              },
              tasks: {
                where: { deletedAt: null },
                select: { id: true, status: true },
              },
              outsourceDeveloper: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  skills: true,
                },
              },
              _count: {
                select: { tasks: true, members: true, comments: true },
              },
            },
          })
          : [];

      const projects = pageIds
        .map((id) => projectsUnordered.find((p) => p.id === id))
        .filter(Boolean) as typeof projectsUnordered;

      const createdByIds = Array.from(
        new Set(projects.map((p) => p.createdBy).filter(Boolean))
      ) as string[];
      const creatorAccounts =
        createdByIds.length > 0
          ? await prisma.account.findMany({
            where: { id: { in: createdByIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              designation: true,
            },
          })
          : [];
      const creatorMap = new Map(creatorAccounts.map((a) => [a.id, a]));

      const data = projects.map((p) => {
        const creatorAcc = p.createdBy ? creatorMap.get(p.createdBy) : null;
        const memberCreator =
          !creatorAcc && p.createdBy
            ? p.members?.find((m) => m.accountId === p.createdBy)?.account
            : null;
        const creator = creatorAcc || memberCreator || null;

        return {
          ...p,
          creator,
          progress: computeProgress(p.tasks),
        };
      });

      sendSuccessResponse(res, 200, "Projects fetched", {
        data,
        meta: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
          statusCounts,
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
        visibility = "PUBLIC",
        priority = false,
        projectType = "UPDATES",
        onWork = false,
        startDate,
        endDate,
        color,
        icon,
        leadId,
        customerId: inputCustomerId,
      } = req.body;

      let finalCustomerId = inputCustomerId;
      if (leadId && !finalCustomerId) {
        const linkedLead = await prisma.lead.findUnique({
          where: { id: leadId },
          select: { customerId: true },
        });
        if (linkedLead?.customerId) {
          finalCustomerId = linkedLead.customerId;
        }
      }

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

      const finalProjectSource = String(req.body.projectSource || "").toUpperCase() === "OUTSOURCE" ? "OUTSOURCE" : "INHOUSE";
      const finalOutsourceDevId = finalProjectSource === "OUTSOURCE" && req.body.outsourceDeveloperId ? String(req.body.outsourceDeveloperId).trim() : undefined;

      const project = await prisma.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: {
            name: name.trim(),
            description,
            status,
            visibility,
            priority: priority === true || priority === "true",
            projectType: projectType === "NEW_PROJECT" ? "NEW_PROJECT" : "UPDATES",
            projectSource: finalProjectSource,
            outsourceDeveloperId: finalOutsourceDevId || undefined,
            onWork: status === "COMPLETED" ? false : (onWork === true || onWork === "true"),
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            color,
            icon,
            createdBy: accountId,
            leadId: leadId || undefined,
            customerId: finalCustomerId || undefined,
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
            { pipelineId: pipeline.id, name: "To Do", order: 0, isTerminal: false, wipLimit: 0 },
            { pipelineId: pipeline.id, name: "In Progress", order: 1, isTerminal: false, wipLimit: 0 },
            { pipelineId: pipeline.id, name: "Done", order: 2, isTerminal: true, wipLimit: 0 },
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
            const metaObj = (typeof att.meta === "object" && att.meta !== null) ? { ...att.meta } : {};
            if (att.description) {
              metaObj.description = String(att.description).trim();
            }
            await tx.projectAttachment.create({
              data: {
                projectId: created.id,
                name: att.name,
                source: "UPLOAD",
                url: att.url,
                mimeType: att.mimeType || null,
                sizeBytes: att.sizeBytes ? Number(att.sizeBytes) : null,
                meta: Object.keys(metaObj).length > 0 ? metaObj : null,
                uploadedBy: accountId,
              },
            }).catch((err) => {
              console.warn(`[project.controller] Skip attachment error ${att.name}:`, err);
            });
          }
        }

        // Handle files uploaded via FormData (req.files) during project creation
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
          let attachmentDescriptions: any[] = [];
          if (req.body.attachmentDescriptions) {
            try {
              attachmentDescriptions = typeof req.body.attachmentDescriptions === "string"
                ? JSON.parse(req.body.attachmentDescriptions)
                : req.body.attachmentDescriptions;
            } catch {
              attachmentDescriptions = [];
            }
          }

          const filesArr = req.files as Express.Multer.File[];
          for (let i = 0; i < filesArr.length; i++) {
            const file = filesArr[i];
            const ext = path.extname(file.originalname).replace(".", "").toLowerCase() || "other";
            const relativeUrl = `/storage/projectAttachment/${ext}/${file.filename}`;

            const descItem = Array.isArray(attachmentDescriptions)
              ? attachmentDescriptions.find((d: any) => d?.name === file.originalname) || attachmentDescriptions[i]
              : null;
            const descText = typeof descItem === "string" ? descItem : descItem?.description;
            const metaObj = descText ? { description: String(descText).trim() } : null;

            await tx.projectAttachment.create({
              data: {
                projectId: created.id,
                name: file.originalname,
                source: "UPLOAD",
                url: relativeUrl,
                mimeType: file.mimetype || null,
                sizeBytes: file.size ? Number(file.size) : null,
                meta: metaObj || undefined,
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

      if (project) {
        // 1. Log project creation
        await logProjectActivity({
          projectId: project.id,
          entityType: "PROJECT",
          entityId: project.id,
          action: "CREATED",
          performedBy: accountId,
          toState: {
            name: project.name,
            status: project.status,
            visibility: project.visibility,
          },
          meta: {
            name: project.name,
            visibility: project.visibility,
            status: project.status,
            message: `Created project "${project.name}"`,
          },
        });

        // 2. Log initial members added
        if (Array.isArray(project.members)) {
          for (const m of project.members) {
            const mName = [m.account?.firstName, m.account?.lastName].filter(Boolean).join(" ").trim();
            await logProjectActivity({
              projectId: project.id,
              entityType: "PROJECT",
              entityId: m.accountId,
              action: "ASSIGNED",
              performedBy: accountId,
              meta: {
                memberId: m.accountId,
                memberName: mName || "Member",
                role: m.role,
                message: `Added ${mName || "member"} as ${m.role === "OWNER" ? "Creator" : m.role === "MANAGER" ? "Developer" : m.role}`,
              },
            });
          }
        }

        // 3. Log initial attachments uploaded
        if (Array.isArray(project.attachments)) {
          for (const att of project.attachments) {
            await logProjectActivity({
              projectId: project.id,
              entityType: "ATTACHMENT",
              entityId: att.id,
              action: "ATTACHMENT_ADDED",
              performedBy: accountId,
              meta: {
                fileName: att.name,
                sizeBytes: att.sizeBytes,
                mimeType: att.mimeType,
                message: `Added attachment "${att.name}"`,
              },
            });
          }
        }
      }

      safeEmitProject("project:created", responseData);
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
          lead: {
            select: {
              id: true,
              customerName: true,
              mobileNumber: true,
              customerCompanyName: true,
              productTitle: true,
              product: true,
              cost: true,
              remark: true,
              status: true,
              createdAt: true,
              states: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              customerCompanyName: true,
              contactPerson: true,
              mobile: true,
              email: true,
              city: true,
              state: true,
            },
          },
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
          outsourceDeveloper: true,
          _count: {
            select: { tasks: true, members: true },
          },
        },
      });

      if (!project) {
        return sendErrorResponse(res, 404, "Project not found");
      }

      const user = (req as any).user;
      const accountId = await getAccountIdFromReqUser(user);
      const isAdmin = Boolean(
        user?.role === "ADMIN" ||
        user?.roles?.includes("ADMIN") ||
        user?.roles?.includes("SUPER_ADMIN") ||
        user?.isSuperAdmin
      );

      if (!isAdmin && project.visibility === "PRIVATE") {
        const isMember = project.members.some((m) => m.accountId === accountId);
        const isCreator = project.createdBy === accountId || project.createdBy === user?.id;
        if (!isMember && !isCreator) {
          return sendErrorResponse(res, 403, "Access denied: This is a private project accessible only to assigned members");
        }
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
      const existing = await prisma.project.findFirst({
        where: { id, deletedAt: null },
        include: { customFields: true },
      });
      if (!existing) return sendErrorResponse(res, 404, "Project not found");

      const { isAdmin, isFullAccess, role } = await getCallerProjectRole(id, user);
      const isCreator = Boolean(
        (accountId && existing.createdBy === accountId) ||
        (user?.id && existing.createdBy === user.id) ||
        role === "OWNER"
      );
      const isDeveloper = role === "MANAGER" || (user?.designation && /developer/i.test(user.designation)) || (user?.role && /developer/i.test(user.role));

      // Priority permission check: Only Admin users can update priority
      if (req.body.priority !== undefined) {
        const newPriority = req.body.priority === true || req.body.priority === "true";
        if (newPriority !== existing.priority && !isAdmin) {
          return sendErrorResponse(res, 403, "Only Admin users can update priority");
        }
      }

      // On Work permission check: Only Project Creator and Developer can update onWork
      if (req.body.onWork !== undefined) {
        const newOnWork = req.body.onWork === true || req.body.onWork === "true";
        if (newOnWork !== existing.onWork && !isCreator && !isDeveloper) {
          return sendErrorResponse(res, 403, "Only the Project Creator and Developer can update onWork");
        }
      }

      // CreatedBy / Ownership transfer permission check: Only the current Project Creator can change createdBy
      if (req.body.createdBy !== undefined) {
        const newCreatedBy = req.body.createdBy ? String(req.body.createdBy).trim() : null;
        if (newCreatedBy && newCreatedBy !== existing.createdBy) {
          if (!isCreator) {
            return sendErrorResponse(res, 403, "Only the current Project Creator can change the project owner");
          }
          const targetAccount = await prisma.account.findUnique({
            where: { id: newCreatedBy },
            select: { id: true, firstName: true, lastName: true },
          });
          if (!targetAccount) {
            return sendErrorResponse(res, 400, "Selected user for project owner was not found");
          }
        }
      }

      // General updates permission check: Only Owners, Managers, or Admins
      const reqKeys = Object.keys(req.body);
      const isOnlyToggle = reqKeys.every((k) => k === "priority" || k === "onWork" || k === "createdBy");
      if (!isOnlyToggle && !isFullAccess) {
        return sendErrorResponse(res, 403, "Only project Owners, Managers, or Admins can update this project");
      }

      const allowedFields = [
        "name", "description", "status", "visibility",
        "startDate", "endDate", "color", "icon", "coverUrl",
        "leadId", "customerId", "priority", "projectType", "onWork", "createdBy",
        "projectSource", "outsourceDeveloperId",
      ];

      const data: Record<string, any> = {};
      for (const f of allowedFields) {
        if (req.body[f] !== undefined) {
          if (f === "startDate" || f === "endDate") {
            data[f] = req.body[f] ? new Date(req.body[f]) : null;
          } else if (f === "priority" || f === "onWork") {
            data[f] = req.body[f] === true || req.body[f] === "true";
          } else if (f === "projectType") {
            data[f] = req.body[f] === "NEW_PROJECT" ? "NEW_PROJECT" : "UPDATES";
          } else if (f === "projectSource") {
            data[f] = String(req.body[f]).toUpperCase() === "OUTSOURCE" ? "OUTSOURCE" : "INHOUSE";
          } else if (f === "outsourceDeveloperId") {
            data[f] = req.body[f] ? String(req.body[f]).trim() : null;
          } else if (f === "createdBy") {
            data[f] = req.body[f] ? String(req.body[f]).trim() : null;
          } else {
            data[f] = req.body[f];
          }
        }
      }

      if (data.leadId && !data.customerId && !existing.customerId) {
        const linkedLead = await prisma.lead.findUnique({
          where: { id: data.leadId },
          select: { customerId: true },
        });
        if (linkedLead?.customerId) {
          data.customerId = linkedLead.customerId;
        }
      }

      if (data.status === "ACTIVE" && !existing.startedAt) {
        data.startedAt = new Date();
      } else if (data.status === "COMPLETED") {
        if (!existing.completedAt || existing.status !== "COMPLETED") {
          data.completedAt = new Date();
        }
        data.onWork = false;
      } else if (data.status === "CANCELLED") {
        if (!existing.cancelledAt || existing.status !== "CANCELLED") {
          data.cancelledAt = new Date();
        }
      } else if (data.status && data.status !== "COMPLETED" && existing.status === "COMPLETED") {
        data.completedAt = null;
      }

      let members = req.body.members;
      if (typeof members === "string") {
        try { members = JSON.parse(members); } catch { members = undefined; }
      }

      let customFields = req.body.customFields;
      if (typeof customFields === "string") {
        try { customFields = JSON.parse(customFields); } catch { customFields = undefined; }
      }

      let customFieldsChanged = false;
      if (Array.isArray(customFields)) {
        const oldFields = existing.customFields || [];
        if (customFields.length !== oldFields.length) {
          customFieldsChanged = true;
        } else {
          for (let i = 0; i < customFields.length; i++) {
            const cf = customFields[i];
            const old = oldFields.find((o) => o.name === cf.name);
            if (!old) {
              customFieldsChanged = true;
              break;
            }
            const oldVal = (old.options as any)?.value ?? "";
            const newVal = cf.value ?? "";
            if (
              old.fieldType !== cf.fieldType ||
              Boolean(old.required) !== Boolean(cf.required) ||
              String(oldVal) !== String(newVal)
            ) {
              customFieldsChanged = true;
              break;
            }
          }
        }
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
              await tx.projectMember.delete({ where: { id: em.id } }).catch(() => { });
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
                }).catch(() => { });
              }
            } else {
              await tx.projectMember.create({
                data: {
                  projectId: id,
                  accountId: m.accountId,
                  role: m.role || "MEMBER",
                  addedBy: accountId || existing.createdBy,
                },
              }).catch(() => { });
            }
          }
        }

        // If ownership changed, ensure new owner has OWNER role and former owner is updated
        if (data.createdBy && data.createdBy !== existing.createdBy) {
          // Promote new owner to OWNER
          await tx.projectMember.upsert({
            where: { projectId_accountId: { projectId: id, accountId: data.createdBy } },
            create: {
              projectId: id,
              accountId: data.createdBy,
              role: "OWNER",
              addedBy: accountId || existing.createdBy,
            },
            update: {
              role: "OWNER",
            },
          });

          // Demote former owner to MANAGER if they had OWNER role
          if (existing.createdBy && existing.createdBy !== data.createdBy) {
            await tx.projectMember.updateMany({
              where: { projectId: id, accountId: existing.createdBy, role: "OWNER" },
              data: { role: "MANAGER" },
            });
          }
        }

        // Update custom fields only if provided and changed
        if (customFieldsChanged && Array.isArray(customFields)) {
          await tx.projectCustomField.deleteMany({ where: { projectId: id } }).catch(() => { });
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
            }).catch(() => { });
          }
        }

        // Upload new attachment files if provided via req.files
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
          let attachmentDescriptions: any[] = [];
          if (req.body.attachmentDescriptions) {
            try {
              attachmentDescriptions = typeof req.body.attachmentDescriptions === "string"
                ? JSON.parse(req.body.attachmentDescriptions)
                : req.body.attachmentDescriptions;
            } catch {
              attachmentDescriptions = [];
            }
          }

          const filesArr = req.files as Express.Multer.File[];
          for (let i = 0; i < filesArr.length; i++) {
            const file = filesArr[i];
            const ext = path.extname(file.originalname).replace(".", "").toLowerCase() || "other";
            const relativeUrl = `/storage/projectAttachment/${ext}/${file.filename}`;

            const descItem = Array.isArray(attachmentDescriptions)
              ? attachmentDescriptions.find((d: any) => d?.name === file.originalname) || attachmentDescriptions[i]
              : null;
            const descText = typeof descItem === "string" ? descItem : descItem?.description;
            const metaObj = descText ? { description: String(descText).trim() } : null;

            await tx.projectAttachment.create({
              data: {
                projectId: id,
                name: file.originalname,
                source: "UPLOAD",
                url: relativeUrl,
                mimeType: file.mimetype || null,
                sizeBytes: file.size ? Number(file.size) : null,
                meta: metaObj || undefined,
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
            outsourceDeveloper: true,
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

      let creator: any = null;
      if (updated?.createdBy) {
        const creatorAcc = await prisma.account.findUnique({
          where: { id: updated.createdBy },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            designation: true,
          },
        });
        creator = creatorAcc || updated.members?.find((m: any) => m.accountId === updated.createdBy || m.role === "OWNER")?.account || null;
      }

      const responseData = updated
        ? {
          ...updated,
          creator,
          customFields: formatCustomFields(updated.customFields),
        }
        : updated;

      if (updated) {
        // 1. Status change
        if (data.status && data.status !== existing.status) {
          await logProjectActivity({
            projectId: id,
            entityType: "PROJECT",
            action: "STATUS_CHANGED",
            performedBy: accountId,
            fromState: { status: existing.status },
            toState: { status: data.status },
            meta: {
              from: existing.status,
              to: data.status,
              message: `Status changed from ${existing.status} to ${data.status}`,
            },
          });
        }

        // 2. Visibility change
        if (data.visibility && data.visibility !== existing.visibility) {
          await logProjectActivity({
            projectId: id,
            entityType: "PROJECT",
            action: "UPDATED",
            performedBy: accountId,
            fromState: { visibility: existing.visibility },
            toState: { visibility: data.visibility },
            meta: {
              field: "visibility",
              from: existing.visibility,
              to: data.visibility,
              message: `Visibility changed from ${existing.visibility} to ${data.visibility}`,
            },
          });
        }

        // 3. Ownership / CreatedBy change
        if (data.createdBy && data.createdBy !== existing.createdBy) {
          const newOwnerAcc = await prisma.account.findUnique({
            where: { id: data.createdBy },
            select: { firstName: true, lastName: true },
          });
          const newOwnerName = `${newOwnerAcc?.firstName || ""} ${newOwnerAcc?.lastName || ""}`.trim() || "User";
          await logProjectActivity({
            projectId: id,
            entityType: "PROJECT",
            action: "UPDATED",
            performedBy: accountId,
            meta: {
              field: "createdBy",
              oldValue: existing.createdBy,
              newValue: data.createdBy,
              message: `Transferred project ownership to ${newOwnerName}`,
            },
          });
        }

        // 4. Description update
        if (data.description !== undefined && data.description !== existing.description) {
          await logProjectActivity({
            projectId: id,
            entityType: "PROJECT",
            action: "UPDATED",
            performedBy: accountId,
            meta: {
              field: "description",
              message: "Updated project description",
            },
          });
        }

        // 5. Other core fields (name, dates, color, icon)
        const ignoredKeys = [
          "status",
          "visibility",
          "description",
          "startedAt",
          "completedAt",
          "cancelledAt",
          "createdBy",
        ];

        const otherKeys = Object.keys(data).filter((k) => {
          if (ignoredKeys.includes(k)) return false;
          const newVal = data[k];
          const oldVal = (existing as any)[k];

          if (k === "startDate" || k === "endDate") {
            const newTime = newVal instanceof Date ? newVal.getTime() : newVal ? new Date(newVal).getTime() : null;
            const oldTime = oldVal instanceof Date ? oldVal.getTime() : oldVal ? new Date(oldVal).getTime() : null;
            return newTime !== oldTime;
          }

          if (newVal === undefined) return false;
          const normalizedNew = newVal === null || newVal === "" ? null : newVal;
          const normalizedOld = oldVal === null || oldVal === "" ? null : oldVal;
          return normalizedNew !== normalizedOld;
        });

        if (otherKeys.length > 0) {
          await logProjectActivity({
            projectId: id,
            entityType: "PROJECT",
            action: "UPDATED",
            performedBy: accountId,
            meta: {
              fields: otherKeys,
              message: `Updated project properties (${otherKeys.join(", ")})`,
            },
          });
        }

        // 5. Custom fields update
        if (customFieldsChanged && Array.isArray(customFields) && (customFields.length > 0 || (existing.customFields && existing.customFields.length > 0))) {
          await logProjectActivity({
            projectId: id,
            entityType: "LABEL",
            action: "UPDATED",
            performedBy: accountId,
            meta: {
              type: "CUSTOM_FIELDS_UPDATED",
              message: `Updated custom fields (${customFields.length} field${customFields.length === 1 ? "" : "s"})`,
            },
          });
        }

        // 6. New attachments uploaded during update
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
          const filesArr = req.files as Express.Multer.File[];
          for (const file of filesArr) {
            await logProjectActivity({
              projectId: id,
              entityType: "ATTACHMENT",
              action: "ATTACHMENT_ADDED",
              performedBy: accountId,
              meta: {
                fileName: file.originalname,
                sizeBytes: file.size,
                mimeType: file.mimetype,
                message: `Added attachment "${file.originalname}"`,
              },
            });
          }
        }
      }

      safeEmitProject("project:patch", { id, patch: responseData }, id);
      safeEmitProject("project:updated", responseData, id);
      sendSuccessResponse(res, 200, "Project updated successfully", responseData);
    } catch (error: any) {
      console.error("[project.controller] updateProject:", error);
      if (error.code === "P2025") return sendErrorResponse(res, 404, "Project not found");
      sendErrorResponse(res, 500, error.message || "Failed to update project");
    }
  }

  /* =========================================================
     DELETE /projects/:id  — hard delete (only OWNER / Creator)
  ========================================================= */
  export async function deleteProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const user = (req as any).user;
      const accountId = await getAccountIdFromReqUser(user);

      const isAdmin = Boolean(
        user?.roles?.includes("ADMIN") ||
        user?.role === "ADMIN" ||
        (Array.isArray(user?.roles) && user.roles.some((r: string) => r.toUpperCase() === "ADMIN")) ||
        user?.isSuperAdmin
      );

      const existing = await prisma.project.findUnique({
        where: { id },
        include: {
          members: true,
        },
      });
      if (!existing) return sendErrorResponse(res, 404, "Project not found");

      const callerMember = existing.members.find(
        (m) => m.accountId === accountId || (user?.id && m.accountId === user.id)
      );
      const isOwner = callerMember?.role === "OWNER";
      const isCreator = Boolean(existing.createdBy && (existing.createdBy === accountId || existing.createdBy === user?.id));

      if (!isAdmin && !isOwner && !isCreator) {
        return sendErrorResponse(res, 403, "Only the project creator or OWNER can hard-delete this project");
      }

      // 1. Collect and delete all physical attachment files from disk
      const projectAttachments = await prisma.projectAttachment.findMany({
        where: { projectId: id },
        select: { url: true },
      });
      for (const att of projectAttachments) {
        deletePhysicalFile(att.url);
      }

      const taskAttachments = await prisma.taskAttachment.findMany({
        where: { task: { projectId: id } },
        select: { url: true },
      });
      for (const att of taskAttachments) {
        deletePhysicalFile(att.url);
      }

      // 2. Cascade delete all linked database records in a transaction
      await prisma.$transaction(async (tx) => {
        // Find all tasks in this project
        const tasks = await tx.task.findMany({
          where: { projectId: id },
          select: { id: true },
        });
        const taskIds = tasks.map((t) => t.id);

        if (taskIds.length > 0) {
          // Clean up task dependencies
          await tx.taskDependency.deleteMany({
            where: {
              OR: [
                { dependentTaskId: { in: taskIds } },
                { blockingTaskId: { in: taskIds } },
              ],
            },
          });

          // Task comments and comment mentions
          const taskComments = await tx.taskComment.findMany({
            where: { taskId: { in: taskIds } },
            select: { id: true },
          });
          const taskCommentIds = taskComments.map((c) => c.id);
          if (taskCommentIds.length > 0) {
            await tx.commentMention.deleteMany({
              where: { commentId: { in: taskCommentIds } },
            });
            await tx.taskComment.deleteMany({
              where: { taskId: { in: taskIds } },
            });
          }

          // Task attachments, assignments, checklists, watchers, time entries, custom field values, labels
          await tx.taskAttachment.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskAssignment.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.checklistItem.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskWatcher.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskTimeEntry.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskCustomFieldValue.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskLabel.deleteMany({ where: { taskId: { in: taskIds } } });

          // Activity logs for tasks
          await tx.activityLog.deleteMany({ where: { taskId: { in: taskIds } } });

          // Break parent/recurrence links before deleting tasks
          await tx.task.updateMany({
            where: { id: { in: taskIds } },
            data: { parentTaskId: null, recurrenceParentId: null },
          });

          // Delete tasks
          await tx.task.deleteMany({ where: { id: { in: taskIds } } });
        }

        // Delete custom field values associated with this project's custom fields
        const customFields = await tx.projectCustomField.findMany({
          where: { projectId: id },
          select: { id: true },
        });
        const customFieldIds = customFields.map((cf) => cf.id);
        if (customFieldIds.length > 0) {
          await tx.taskCustomFieldValue.deleteMany({
            where: { fieldId: { in: customFieldIds } },
          });
          await tx.projectCustomField.deleteMany({
            where: { projectId: id },
          });
        }

        // Delete project comments
        await tx.projectComment.deleteMany({ where: { projectId: id } });

        // Delete project attachments
        await tx.projectAttachment.deleteMany({ where: { projectId: id } });

        // Delete project members
        await tx.projectMember.deleteMany({ where: { projectId: id } });

        // Delete project pipeline & steps
        const pipeline = await tx.projectPipeline.findUnique({
          where: { projectId: id },
          select: { id: true },
        });
        if (pipeline) {
          await tx.pipelineStep.deleteMany({ where: { pipelineId: pipeline.id } });
          await tx.projectPipeline.delete({ where: { id: pipeline.id } });
        }

        // Delete activity logs for project
        await tx.activityLog.deleteMany({ where: { projectId: id } });

        // Finally delete the project itself
        await tx.project.delete({ where: { id } });
      });

      safeEmitProject("project:deleted", { id }, id);
      sendSuccessResponse(res, 200, "Project and all linked data permanently deleted");
    } catch (error: any) {
      console.error("[project.controller] deleteProject:", error);
      sendErrorResponse(res, 500, error.message || "Failed to delete project");
    }
  }

  /* =========================================================
     HELPER: Get Caller's Project Membership & Role
  ========================================================= */
  export async function getCallerProjectRole(projectId: string, user: any): Promise<{ isAdmin: boolean; callerAccountId: string | null; role: string | null; isFullAccess: boolean }> {
    const isAdmin = Boolean(
      user?.roles?.includes("ADMIN") ||
      user?.role === "ADMIN" ||
      (Array.isArray(user?.roles) && user.roles.some((r: string) => r.toUpperCase() === "ADMIN"))
    );
    const callerAccountId = await getAccountIdFromReqUser(user);
    if (!callerAccountId) return { isAdmin, callerAccountId: null, role: null, isFullAccess: isAdmin };

    const member = await prisma.projectMember.findUnique({
      where: { projectId_accountId: { projectId, accountId: callerAccountId } },
      select: { role: true },
    });

    const role = member?.role || null;
    const isFullAccess = isAdmin || role === "OWNER" || role === "MANAGER";

    return { isAdmin, callerAccountId, role, isFullAccess };
  }

  /* =========================================================
     POST /projects/:id/members  — add member
  ========================================================= */
  export async function addProjectMember(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const user = (req as any).user;
      const { isAdmin, callerAccountId, role: callerRole, isFullAccess } = await getCallerProjectRole(id, user);

      if (!isFullAccess) {
        return sendErrorResponse(res, 403, "Only project Owners, Managers, or Admins can add members");
      }

      const { accountId, role = "MEMBER" } = req.body;
      const VALID_ROLES = ["OWNER", "MANAGER", "MEMBER", "VIEWER", "REVIEWER"];
      if (!role || !VALID_ROLES.includes(role)) {
        return sendErrorResponse(res, 400, `role must be one of: ${VALID_ROLES.join(", ")}`);
      }

      if (!isAdmin && callerRole === "MANAGER" && role === "OWNER") {
        return sendErrorResponse(res, 403, "Managers cannot assign Owner role");
      }

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
          addedBy: callerAccountId || user?.id,
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

      const mName = [account.firstName, account.lastName].filter(Boolean).join(" ").trim();
      await logProjectActivity({
        projectId: id,
        entityType: "PROJECT",
        entityId: accountId,
        action: "ASSIGNED",
        performedBy: callerAccountId || user?.id,
        meta: {
          memberId: accountId,
          memberName: mName || "Member",
          role,
          message: `Added ${mName || "member"} as ${role === "OWNER" ? "Creator" : role === "MANAGER" ? "Developer" : role}`,
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
      const user = (req as any).user;
      const { isAdmin, callerAccountId, role: callerRole } = await getCallerProjectRole(id, user);

      if (!isAdmin && callerRole !== "OWNER" && callerRole !== "MANAGER") {
        return sendErrorResponse(res, 403, "Only project Owners, Managers, or Admins can remove members");
      }

      const member = await prisma.projectMember.findUnique({
        where: { projectId_accountId: { projectId: id, accountId } },
        include: {
          account: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
      if (!member) return sendErrorResponse(res, 404, "Member not found");

      // Enforce role rule: MANAGER cannot remove OWNER
      if (member.role === "OWNER") {
        if (!isAdmin && callerRole === "MANAGER") {
          return sendErrorResponse(res, 403, "Managers cannot remove the Project Owner");
        }
        const ownerCount = await prisma.projectMember.count({
          where: { projectId: id, role: "OWNER" },
        });
        if (ownerCount <= 1) {
          return sendErrorResponse(res, 400, "Cannot remove the last project owner");
        }
      }

      await prisma.projectMember.delete({
        where: { projectId_accountId: { projectId: id, accountId } },
      });

      const mName = [member.account?.firstName, member.account?.lastName].filter(Boolean).join(" ").trim();
      await logProjectActivity({
        projectId: id,
        entityType: "PROJECT",
        entityId: accountId,
        action: "UNASSIGNED",
        performedBy: callerAccountId || user?.id,
        meta: {
          memberId: accountId,
          memberName: mName || "Member",
          role: member.role,
          message: `Removed ${mName || "member"} from project`,
        },
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
      const user = (req as any).user;
      const { isAdmin, callerAccountId, role: callerRole } = await getCallerProjectRole(id, user);

      if (!isAdmin && callerRole !== "OWNER" && callerRole !== "MANAGER") {
        return sendErrorResponse(res, 403, "Only project Owners, Managers, or Admins can edit member roles");
      }

      const VALID_ROLES = ["OWNER", "MANAGER", "MEMBER", "VIEWER", "REVIEWER"];
      if (!role || !VALID_ROLES.includes(role)) {
        return sendErrorResponse(res, 400, `role must be one of: ${VALID_ROLES.join(", ")}`);
      }

      const member = await prisma.projectMember.findUnique({
        where: { projectId_accountId: { projectId: id, accountId } },
      });
      if (!member) return sendErrorResponse(res, 404, "Member not found");

      // Enforce role rule: MANAGER cannot change OWNER's role
      if (member.role === "OWNER" && !isAdmin && callerRole === "MANAGER") {
        return sendErrorResponse(res, 403, "Managers cannot modify the Project Owner's role");
      }

      // Enforce role rule: MANAGER cannot assign OWNER role
      if (role === "OWNER" && !isAdmin && callerRole === "MANAGER") {
        return sendErrorResponse(res, 403, "Managers cannot promote members to Owner");
      }

      if (member.role === "OWNER" && role !== "OWNER") {
        // Count remaining owners before demoting
        const ownerCount = await prisma.projectMember.count({
          where: { projectId: id, role: "OWNER" },
        });
        if (ownerCount <= 1) {
          return sendErrorResponse(res, 400, "Cannot remove or demote the last project owner");
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

      const mName = [updated.account?.firstName, updated.account?.lastName].filter(Boolean).join(" ").trim();
      await logProjectActivity({
        projectId: id,
        entityType: "PROJECT",
        entityId: accountId,
        action: "UPDATED",
        performedBy: callerAccountId || user?.id,
        meta: {
          memberId: accountId,
          memberName: mName || "Member",
          fromRole: member.role,
          toRole: role,
          message: `Changed ${mName || "member"}'s role from ${member.role === "OWNER" ? "Creator" : member.role === "MANAGER" ? "Developer" : member.role} to ${role === "OWNER" ? "Creator" : role === "MANAGER" ? "Developer" : role}`,
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
        ...(status && { status }),
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

  /* =========================================================
     GET /projects/:id/activities  — list project activity logs
  ========================================================= */
  export async function getProjectActivities(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
      const action = req.query.action as string | undefined;
      const entityType = req.query.entityType as string | undefined;

      const project = await prisma.project.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!project) return sendErrorResponse(res, 404, "Project not found");

      const where: any = { projectId: id };
      if (action) where.action = action;
      if (entityType) where.entityType = entityType;

      const [total, activities] = await Promise.all([
        prisma.activityLog.count({ where }),
        prisma.activityLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
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
        }),
      ]);

      const actorIds = [...new Set(activities.map((a) => a.performedBy).filter(Boolean) as string[])];
      const actors = await prisma.account.findMany({
        where: { id: { in: actorIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          avatar: true,
        },
      });
      const actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));

      const enriched = activities.map((a) => ({
        ...a,
        performer: a.performedBy ? (actorMap[a.performedBy] ?? null) : null,
      }));

      sendSuccessResponse(res, 200, "Project activities fetched", {
        data: enriched,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error: any) {
      console.error("[project.controller] getProjectActivities:", error);
      sendErrorResponse(res, 500, error.message || "Failed to fetch project activities");
    }
  }

