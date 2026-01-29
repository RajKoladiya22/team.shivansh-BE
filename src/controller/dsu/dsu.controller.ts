// src/controller/dsu.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * Helpers
 */
const normalizeToDay = (d?: string | Date) => {
  const date = d ? new Date(d) : new Date();
  // normalize to local midnight (or pick UTC convention used in your app)
  date.setHours(0, 0, 0, 0);
  return date;
};

const safeParseInt = (v: unknown, fallback = 1) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const allowedTemplateSort = new Set(["createdAt", "updatedAt", "name"]);
const allowedEntrySort = new Set([
  "date",
  "createdAt",
  "submittedAt",
  "updatedAt",
  "accountId",
]);

/* --------------------
   TEMPLATE APIs (ADMIN)
   -------------------- */

/**
 * POST /dsu/admin/templates
 * body: { name, description?, teamId?, config (JSON), isActive? }
 */
export async function createDsuTemplate(req: Request, res: Response) {
  try {
    // guard admin
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const creatorUserId = req.user?.id;
    if (!creatorUserId) return sendErrorResponse(res, 401, "Unauthorized");

    const { name, description, teamId, config, isActive } = req.body as any;
    if (!name || !config) return sendErrorResponse(res, 400, "name & config required");

    const template = await prisma.dsuTemplate.create({
      data: {
        name,
        description: description ?? null,
        teamId: teamId ?? null,
        createdBy: creatorUserId,
        isActive: isActive ?? true,
        config,
      },
    });

    // create initial version
    await prisma.dsuTemplateVersion.create({
      data: { templateId: template.id, version: 1, config, createdBy: creatorUserId },
    });

    return sendSuccessResponse(res, 201, "Template created", template);
  } catch (err: any) {
    console.error("createDsuTemplate error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create template");
  }
}

/**
 * PATCH /admin/dsu/templates/:id
 * update template and create a new version (if config changed)
 */
export async function updateDsuTemplate(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");
    const { id } = req.params;
    const { name, description, teamId, config, isActive } = req.body as any;

    const tpl = await prisma.dsuTemplate.findUnique({ where: { id } });
    if (!tpl) return sendErrorResponse(res, 404, "Template not found");

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.dsuTemplate.update({
        where: { id },
        data: {
          name: name ?? undefined,
          description: description ?? undefined,
          teamId: teamId ?? undefined,
          isActive: isActive ?? undefined,
          config: config ?? undefined,
        },
      });

      if (config) {
        // compute new version number
        const lastVer = await tx.dsuTemplateVersion.findFirst({
          where: { templateId: id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const nextVersion = (lastVer?.version ?? 0) + 1;
        await tx.dsuTemplateVersion.create({
          data: { templateId: id, version: nextVersion, config, createdBy: req.user?.id },
        });
      }

      return t;
    });

    return sendSuccessResponse(res, 200, "Template updated", updated);
  } catch (err: any) {
    console.error("updateDsuTemplate error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update template");
  }
}

/**
 * DELETE /admin/dsu/templates/:id
 * Soft-delete (deactivate) template
 */
export async function deleteDsuTemplate(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");
    const { id } = req.params;

    const tpl = await prisma.dsuTemplate.findUnique({ where: { id } });
    if (!tpl) return sendErrorResponse(res, 404, "Template not found");

    const updated = await prisma.dsuTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    return sendSuccessResponse(res, 200, "Template deactivated", updated);
  } catch (err: any) {
    console.error("deleteDsuTemplate error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete template");
  }
}

/**
 * GET /dsu/admin/templates
 * query: teamId?, search?, page, limit, sortBy, sortOrder
 */
export async function listDsuTemplates(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const { teamId, search, page = "1", limit = "20", sortBy = "createdAt", sortOrder = "desc" } =
      req.query as Record<string, string>;

    const pageNumber = safeParseInt(page, 1);
    const pageSize = Math.min(safeParseInt(limit, 20), 200);
    const sortField = allowedTemplateSort.has(sortBy) ? sortBy : "createdAt";

    const where: any = {};
    if (teamId) where.teamId = teamId;
    if (search) where.OR = [{ name: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }];

    const [total, templates] = await prisma.$transaction([
      prisma.dsuTemplate.count({ where }),
      prisma.dsuTemplate.findMany({
        where,
        orderBy: { [sortField]: sortOrder === "asc" ? "asc" : "desc" },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return sendSuccessResponse(res, 200, "Templates fetched", {
      data: templates,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    console.error("listDsuTemplates error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to list templates");
  }
}

/**
 * GET /admin/dsu/templates/:id
 */
export async function getDsuTemplate(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");
    const { id } = req.params;
    const tpl = await prisma.dsuTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: "desc" }, take: 10 } },
    });
    if (!tpl) return sendErrorResponse(res, 404, "Template not found");
    return sendSuccessResponse(res, 200, "Template fetched", tpl);
  } catch (err: any) {
    console.error("getDsuTemplate error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch template");
  }
}

/* --------------------
   ENTRY APIs (USER)
   -------------------- */

/**
 * POST /dsu
 * Create or submit DSU for day (create as draft or submitted)
 * body: { templateId?, date?, content (JSON), attachments?, isDraft?, summary? }
 *
 * Enforces uniqueness (one per accountId+date+templateId). Uses transaction + upsert-like logic.
 */
export async function createOrSubmitDsu(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    // helper to get accountId from user
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    const accountId = user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid user session");

    const { templateId, date, content, attachments, isDraft = false, summary } = req.body as any;
    const d = normalizeToDay(date);

    // Optional: validate content shape at runtime (light)
    if (!content || typeof content !== "object")
      return sendErrorResponse(res, 400, "content is required and must be an object");

    // Use transaction: check existing & create or update
    const entry = await prisma.$transaction(async (tx) => {
      const existing = await tx.dsuEntry.findFirst({
        where: { accountId, date: d, templateId: templateId ?? null },
      });

      if (existing) {
        // Update existing (allow overwrite)
        const updated = await tx.dsuEntry.update({
          where: { id: existing.id },
          data: {
            content,
            attachments: attachments ?? null,
            isDraft: !!isDraft,
            submittedAt: isDraft ? null : new Date(),
            summary: summary ?? null,
            updatedAt: new Date(),
          },
        });
        return updated;
      }

      // create new
      const created = await tx.dsuEntry.create({
        data: {
          accountId,
          templateId: templateId ?? null,
          teamId: null, // optionally fill if you know user's team
          date: d,
          content,
          attachments: attachments ?? null,
          isDraft: !!isDraft,
          submittedAt: isDraft ? null : new Date(),
          summary: summary ?? null,
          createdBy: accountId,
        },
      });

      return created;
    });

    return sendSuccessResponse(res, 201, isDraft ? "Draft saved" : "DSU submitted", entry);
  } catch (err: any) {
    console.error("createOrSubmitDsu error:", err);
    if (err?.code === "P2002") {
      return sendErrorResponse(res, 409, "DSU already exists for today");
    }
    return sendErrorResponse(res, 500, err?.message ?? "Failed to submit DSU");
  }
}

/**
 * GET /dsu/me/today
 * returns current user's DSU for today (draft or submitted)
 */
export async function getMyTodayDsu(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    const accountId = user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const date = normalizeToDay(new Date());
    const entry = await prisma.dsuEntry.findFirst({
      where: { accountId, date },
    });

    return sendSuccessResponse(res, 200, "Today DSU fetched", entry ?? null);
  } catch (err: any) {
    console.error("getMyTodayDsu error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch DSU");
  }
}

/**
 * PATCH /dsu/:id
 * Update DSU entry (owner or admin)
 */
export async function updateDsuEntry(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;
    const { content, attachments, isDraft, summary } = req.body as any;

    const existing = await prisma.dsuEntry.findUnique({ where: { id } });
    if (!existing) return sendErrorResponse(res, 404, "DSU entry not found");

    // allow owner or admin
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    const accountId = user?.accountId;
    const isOwner = accountId === existing.accountId;
    const isAdmin = req.user?.roles?.includes?.("ADMIN");

    if (!isOwner && !isAdmin) return sendErrorResponse(res, 403, "Forbidden");

    const updated = await prisma.dsuEntry.update({
      where: { id },
      data: {
        content: content ?? undefined,
        attachments: attachments ?? undefined,
        isDraft: typeof isDraft === "boolean" ? isDraft : undefined,
        summary: summary ?? undefined,
        submittedAt: typeof isDraft === "boolean" && !isDraft ? new Date() : undefined,
      },
    });

    return sendSuccessResponse(res, 200, "DSU updated", updated);
  } catch (err: any) {
    console.error("updateDsuEntry error:", err);
    if (err?.code === "P2002") return sendErrorResponse(res, 409, "Duplicate DSU");
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update DSU");
  }
}

/**
 * DELETE /dsu/:id
 * Soft delete (owner or admin) - we will mark isDraft=true & submittedAt=null OR create a deletedAt flag if schema supports
 */
export async function deleteDsuEntry(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;
    const existing = await prisma.dsuEntry.findUnique({ where: { id } });
    if (!existing) return sendErrorResponse(res, 404, "DSU entry not found");

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    const accountId = user?.accountId;
    const isOwner = accountId === existing.accountId;
    const isAdmin = req.user?.roles?.includes?.("ADMIN");

    if (!isOwner && !isAdmin) return sendErrorResponse(res, 403, "Forbidden");

    // Soft-delete approach: mark isDraft true and clear submittedAt, or add deleted flag if preferred
    const updated = await prisma.dsuEntry.update({
      where: { id },
      data: { isDraft: true, submittedAt: null, summary: null },
    });

    return sendSuccessResponse(res, 200, "DSU entry deleted (soft)", updated);
  } catch (err: any) {
    console.error("deleteDsuEntry error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete DSU");
  }
}

/**
 * GET /dsu/:id
 * Get DSU detail (owner or admin)
 */
export async function getDsuEntry(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;
    const entry = await prisma.dsuEntry.findUnique({
      where: { id },
      include: {
        account: {
          select: { id: true, firstName: true, lastName: true, registerNumber: true, designation: true },
        },
        template: { select: { id: true, name: true } },
      },
    });
    if (!entry) return sendErrorResponse(res, 404, "DSU entry not found");

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    const isOwner = user?.accountId === entry.accountId;
    const isAdmin = req.user?.roles?.includes?.("ADMIN");

    if (!isOwner && !isAdmin) return sendErrorResponse(res, 403, "Forbidden");

    return sendSuccessResponse(res, 200, "DSU entry fetched", entry);
  } catch (err: any) {
    console.error("getDsuEntry error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch DSU entry");
  }
}

/**
 * GET /dsu
 * List DSU entries (admin: all; normal: only own)
 * Filters: accountId, teamId, templateId, date/fromDate/toDate, isDraft
 * Search: search (uses denormalized textSearch column)
 * Pagination: page, limit
 * Sort: sortBy, sortOrder
 */
export async function listDsuEntries(req: Request, res: Response) {
  try {
    const {
      accountId: qAccountId,
      teamId,
      templateId,
      date,
      fromDate,
      toDate,
      isDraft,
      search,
      sortBy = "date",
      sortOrder = "desc",
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = safeParseInt(page, 1);
    const pageSize = Math.min(safeParseInt(limit, 20), 200);
    const sortField = allowedEntrySort.has(sortBy) ? sortBy : "date";

    const isAdmin = req.user?.roles?.includes?.("ADMIN");
    const user = await prisma.user.findUnique({ where: { id: req.user?.id }, select: { accountId: true } });
    const accountId = user?.accountId;

    const where: any = {};
    // permissions: normal users only see their own
    if (!isAdmin) where.accountId = accountId;
    if (qAccountId && isAdmin) where.accountId = qAccountId;
    if (teamId) where.teamId = teamId;
    if (templateId) where.templateId = templateId;
    if (isDraft !== undefined) where.isDraft = isDraft === "true";

    if (date) {
      where.date = { equals: normalizeToDay(date) };
    } else if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = normalizeToDay(fromDate);
      if (toDate) where.date.lte = normalizeToDay(toDate);
    }

    if (search) {
      // use denormalized textSearch for performance
      where.AND = [
        ...(where.AND ?? []),
        { textSearch: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, data] = await prisma.$transaction([
      prisma.dsuEntry.count({ where }),
      prisma.dsuEntry.findMany({
        where,
        include: {
          account: { select: { id: true, firstName: true, lastName: true, registerNumber: true, designation: true } },
          template: { select: { id: true, name: true } },
        },
        orderBy: { [sortField]: sortOrder === "asc" ? "asc" : "desc" },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return sendSuccessResponse(res, 200, "DSU entries fetched", {
      data,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    console.error("listDsuEntries error:", err);
    if (err?.code === "P2021" || err?.code === "P2022") {
      return sendErrorResponse(res, 500, "Database schema mismatch. Run Prisma migration.");
    }
    return sendErrorResponse(res, 500, err?.message ?? "Failed to list DSU entries");
  }
}

/* --------------------
   REPORTS & ANALYTICS (ADMIN)
   -------------------- */

/**
 * GET /admin/dsu/reports/daily-submissions
 * query: fromDate?, toDate?
 * returns counts grouped by date (efficient single groupBy)
 */
export async function getDailySubmissionCounts(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN")) return sendErrorResponse(res, 403, "Admin access required");

    const { fromDate, toDate } = req.query as Record<string, string>;
    const where: any = { isDraft: false }; // only submitted

    if (fromDate || toDate) where.date = {};
    if (fromDate) where.date.gte = normalizeToDay(fromDate);
    if (toDate) where.date.lte = normalizeToDay(toDate);

    const grouped = await prisma.dsuEntry.groupBy({
      by: ["date"],
      where,
      _count: { _all: true },
      orderBy: { date: "desc" },
    });

    const result = grouped.map((r) => ({ date: r.date, count: r._count._all }));
    return sendSuccessResponse(res, 200, "Daily submission counts", result);
  } catch (err: any) {
    console.error("getDailySubmissionCounts error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch report");
  }
}

/**
 * GET /admin/dsu/reports/team-submissions
 * query: fromDate?, toDate?, teamId?
 * returns grouped counts per team (fast groupBy)
 */
export async function getTeamSubmissionCounts(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN")) return sendErrorResponse(res, 403, "Admin access required");

    const { fromDate, toDate, teamId } = req.query as Record<string, string>;
    const where: any = { isDraft: false };

    if (teamId) where.teamId = teamId;
    if (fromDate || toDate) where.date = {};
    if (fromDate) where.date.gte = normalizeToDay(fromDate);
    if (toDate) where.date.lte = normalizeToDay(toDate);

    const grouped = await prisma.dsuEntry.groupBy({
      by: ["teamId"],
      where,
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    });

    const mapped = await Promise.all(
      grouped.map(async (g) => {
        const team = g.teamId ? await prisma.team.findUnique({ where: { id: g.teamId }, select: { id: true, name: true } }) : null;
        return { team: team ? { id: team.id, name: team.name } : null, count: g._count._all };
      }),
    );

    return sendSuccessResponse(res, 200, "Team submission counts", mapped);
  } catch (err: any) {
    console.error("getTeamSubmissionCounts error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch team report");
  }
}

/**
 * GET /admin/dsu/reports/template-usage
 * query: fromDate?, toDate?
 * returns count grouped by templateId (which templates are used)
 */
export async function getTemplateUsageStats(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN")) return sendErrorResponse(res, 403, "Admin access required");

    const { fromDate, toDate } = req.query as Record<string, string>;
    const where: any = { isDraft: false };
    if (fromDate || toDate) where.date = {};
    if (fromDate) where.date.gte = normalizeToDay(fromDate);
    if (toDate) where.date.lte = normalizeToDay(toDate);

    const grouped = await prisma.dsuEntry.groupBy({
      by: ["templateId"],
      where,
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    });

    const rows = await Promise.all(
      grouped.map(async (g) => {
        const tpl = g.templateId ? await prisma.dsuTemplate.findUnique({ where: { id: g.templateId }, select: { id: true, name: true } }) : null;
        return { template: tpl ? { id: tpl.id, name: tpl.name } : null, count: g._count._all };
      }),
    );

    return sendSuccessResponse(res, 200, "Template usage stats", rows);
  } catch (err: any) {
    console.error("getTemplateUsageStats error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch template stats");
  }
}

/**
 * GET /admin/dsu/reports/submission-time-stats
 * Returns average submission delay (time between day-start and submittedAt), min/max/avg seconds
 */
export async function getSubmissionTimeStats(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN")) return sendErrorResponse(res, 403, "Admin access required");

    const { fromDate, toDate } = req.query as Record<string, string>;
    let whereConds: any = `WHERE "isDraft" = false`;
    const params: any[] = [];

    if (fromDate) {
      params.push(normalizeToDay(fromDate).toISOString());
      whereConds += ` AND date >= $${params.length}`;
    }
    if (toDate) {
      params.push(normalizeToDay(toDate).toISOString());
      whereConds += ` AND date <= $${params.length}`;
    }

    /**
     * We use raw SQL for accurate timestamp arithmetic in seconds.
     * Compute submission delay as (EXTRACT(epoch FROM submittedAt - date))
     */
    const sql = `
      SELECT
        AVG(EXTRACT(epoch FROM ("submittedAt" - "date")))::numeric AS avg_seconds,
        MIN(EXTRACT(epoch FROM ("submittedAt" - "date")))::numeric AS min_seconds,
        MAX(EXTRACT(epoch FROM ("submittedAt" - "date")))::numeric AS max_seconds,
        COUNT(*) AS total
      FROM "DsuEntry"
      ${whereConds};
    `;

    const result: any = await prisma.$queryRawUnsafe(sql, ...params);
    return sendSuccessResponse(res, 200, "Submission time stats", result?.[0] ?? null);
  } catch (err: any) {
    console.error("getSubmissionTimeStats error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to compute submission time stats");
  }
}

/* --------------------
   Misc Utilities
   -------------------- */

/**
 * POST /admin/dsu/reports/export
 * Accepts filters (same as list) and returns a streaming/export-ready payload (CSV/JSON).
 * For brevity: returns data array (implement streaming if dataset large)
 */
export async function exportDsuEntries(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN")) return sendErrorResponse(res, 403, "Admin access required");

    // reuse listDsuEntries logic but fetch all (no pagination)
    const { fromDate, toDate, teamId, templateId } = req.body as any;
    const where: any = { isDraft: false };
    if (teamId) where.teamId = teamId;
    if (templateId) where.templateId = templateId;
    if (fromDate || toDate) where.date = {};
    if (fromDate) where.date.gte = normalizeToDay(fromDate);
    if (toDate) where.date.lte = normalizeToDay(toDate);

    const data = await prisma.dsuEntry.findMany({
      where,
      include: {
        account: { select: { id: true, firstName: true, lastName: true, registerNumber: true } },
        template: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
      take: 10000, // guard; large exports should use streaming / cursor
    });

    // For now return JSON; adapt to CSV/stream as needed
    return sendSuccessResponse(res, 200, "Export ready", { data });
  } catch (err: any) {
    console.error("exportDsuEntries error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to export DSU entries");
  }
}
