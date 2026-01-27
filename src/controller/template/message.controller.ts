// src/controllers/template/message.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* ─────────────────────────────
   Helpers
───────────────────────────── */

const getAccountIdFromReqUser = async (userId?: string | null) => {
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountId: true },
  });
  return u?.accountId ?? null;
};

const parseArray = (v?: string) => {
  if (!v) return null;
  if (v.startsWith("[")) return JSON.parse(v);
  return v.split(",").map((x) => x.trim());
};

/* =========================
   CRUD / action handlers
   ========================= */

/**
 * POST /api/v1/templates/message
 */
export async function createTemplate(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);

    const {
      name,
      slug,
      description,
      visibility = "PRIVATE",
      channels,
      subject,
      body,
      variables,
      meta,
      isActive = true,
      isDefault = false,
    } = req.body;

    if (!name || !slug || !channels || !body) {
      return sendErrorResponse(
        res,
        400,
        "name, slug, channels and body are required",
      );
    }

    const template = await prisma.messageTemplate.create({
      data: {
        name,
        slug,
        description: description ?? null,
        visibility,
        accountId, // owner ALWAYS set
        channels: channels,
        subject: subject ?? null,
        body,
        variables: variables,
        meta: meta,
        isActive: Boolean(isActive),
        isDefault: Boolean(isDefault),
        createdBy: accountId ?? userId,
      },
    });

    return sendSuccessResponse(res, 201, "Template created", template);
  } catch (err: any) {
    console.error("createTemplate error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create template",
    );
  }
}

/**
 * GET /api/v1/templates/message
 * query params:
 *  - q (search string)
 *  - channels (comma separated or JSON array)
 *  - visibility (PUBLIC|PRIVATE) - default: PUBLIC and PRIVATE visible to owner
 *  - accountScope: "mine" | "global" | "all"  (mine => privately owned + public; global => only public)
 *  - pinned (true|false) - if true return only pinned for current account
 *  - sortBy (priority|lastUsedAt|createdAt|name) default uses pinned/priority fallback
 *  - order (asc|desc)
 *  - page, limit
 */
// export async function listTemplates(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     const accountId = await getAccountIdFromReqUser(userId);

//     const {
//       q,
//       channels,
//       accountScope = "mine",
//       pinned,
//       visibility,
//       sortBy = "priority",
//       order = "desc",
//       page = "1",
//       limit = "20",
//       activeOnly = "true",
//     } = req.query as Record<string, string>;

//     const pageNumber = Math.max(Number(page) || 1, 1);
//     const pageSize = Math.min(Number(limit) || 20, 200);

//     // ---------- Build DB where (no channels client-side) ----------
//     const and: any[] = [];

//     // Active / inactive
//     if (activeOnly === "true") and.push({ isActive: true });
//     else if (activeOnly === "false") and.push({ isActive: false });

//     // Account scope & visibility defaults
//     if (accountScope === "global") {
//       and.push({ visibility: "PUBLIC" });
//     } else if (accountScope === "mine") {
//       if (!accountId) {
//         and.push({ visibility: "PUBLIC" });
//       } else {
//         and.push({
//           OR: [{ visibility: "PRIVATE", accountId }, { visibility: "PUBLIC" }],
//         });
//       }
//     } else if (accountScope === "all") {
//       if (!req.user?.roles?.includes?.("ADMIN")) {
//         return sendErrorResponse(res, 403, "Admin access required");
//       }
//       // admin sees everything -> no visibility filter
//     }

//     // Explicit visibility override (PUBLIC/PRIVATE)
//     if (visibility) {
//       if (visibility !== "PUBLIC" && visibility !== "PRIVATE") {
//         return sendErrorResponse(res, 400, "Invalid visibility");
//       }
//       // push visibility constraint
//       and.push({ visibility });

//       // if PRIVATE and accountScope=mine, ensure owned by user
//       if (visibility === "PRIVATE") {
//         if (!accountId) {
//           // no account -> nothing will match, return empty
//           return sendSuccessResponse(res, 200, "Templates fetched", {
//             data: [],
//             meta: {
//               page: pageNumber,
//               limit: pageSize,
//               total: 0,
//               totalPages: 0,
//             },
//           });
//         }
//         and.push({ accountId });
//       }
//     }

//     // Search
//     if (q && q.trim().length > 0) {
//       const s = q.trim();
//       and.push({
//         OR: [
//           { name: { contains: s, mode: "insensitive" } },
//           { slug: { contains: s, mode: "insensitive" } },
//           { description: { contains: s, mode: "insensitive" } },
//           { body: { contains: s, mode: "insensitive" } },
//         ],
//       });
//     }

//     // Pinned filter: for pinned=true we require a templatePreference row for this account
//     if (pinned === "true") {
//       if (accountId) {
//         and.push({
//           templatePreferences: {
//             some: { accountId, isPinned: true },
//           },
//         });
//       } else {
//         // not logged in -> no pinned templates
//         return sendSuccessResponse(res, 200, "Templates fetched", {
//           data: [],
//           meta: { page: pageNumber, limit: pageSize, total: 0, totalPages: 0 },
//         });
//       }
//     } else if (pinned === "false" && accountId) {
//       // not pinned for this account: either no pref or pref.isPinned = false
//       and.push({
//         AND: [
//           // allow templates that either have a pref with isPinned=false OR no pref exists
//           {
//             OR: [
//               { templatePreferences: { none: { accountId } } },
//               { templatePreferences: { some: { accountId, isPinned: false } } },
//             ],
//           },
//         ],
//       });
//     }

//     // Compose final DB where
//     const dbWhere = and.length > 0 ? { AND: and } : {};

//     // Decide orderBy for DB-level ordering (we will apply final pinned/priority ordering in JS)
//     const dbOrderBy: any[] = [];
//     if (sortBy === "name")
//       dbOrderBy.push({ name: order === "asc" ? "asc" : "desc" });
//     else if (sortBy === "createdAt")
//       dbOrderBy.push({ createdAt: order === "asc" ? "asc" : "desc" });
//     else if (sortBy === "lastUsedAt")
//       dbOrderBy.push({ lastUsedAt: order === "asc" ? "asc" : "desc" });
//     else {
//       // no db-level priority sort; keep sensible defaults
//       dbOrderBy.push(
//         { isDefault: "desc" },
//         { lastUsedAt: "desc" },
//         { createdAt: "desc" },
//       );
//     }

//     // Include preferences for current account (if any) so we can merge & sort
//     const includePrefs = accountId
//       ? {
//           templatePreferences: {
//             where: { accountId },
//             select: {
//               id: true,
//               isPinned: true,
//               priority: true,
//               isHidden: true,
//               createdAt: true,
//               updatedAt: true,
//             },
//           },
//         }
//       : { templatePreferences: false };

//     console.log(
//       "\n\nlistTemplates dbWhere:\n",
//       JSON.stringify(dbWhere, null, 2),
//     );

//     // Fetch all candidate templates (we will filter channels in JS and then paginate)
//     // NOTE: templates count is usually small; if you expect many, we can change this approach.
//     const templates = await prisma.messageTemplate.findMany({
//       where: dbWhere,
//       include: includePrefs,
//       orderBy: dbOrderBy,
//     });

//     // ----------------- Client-side channel filtering -----------------
//     let filtered = templates;

//     if (channels) {
//       const wanted = channels.startsWith("[")
//         ? JSON.parse(channels)
//         : channels.split(",").map((c) => c.trim());
//       // normalize wanted entries to strings
//       const wantedSet = new Set(wanted.map(String));
//       filtered = filtered.filter((t) => {
//         // handle t.channels being stored as JSON (array of strings) or a string
//         const ch = t.channels;
//         if (!ch) return false;
//         try {
//           const arr = Array.isArray(ch)
//             ? ch
//             : typeof ch === "string"
//               ? JSON.parse(ch)
//               : ch;
//           if (!Array.isArray(arr)) return false;
//           for (const c of arr) {
//             if (wantedSet.has(String(c))) return true;
//           }
//           return false;
//         } catch {
//           // fallback: if channels serialized to string, do substring match
//           const s = String(ch);
//           for (const w of wantedSet) {
//             if (s.includes(w as any)) return true;
//           }
//           return false;
//         }
//       });
//     }

//     // ----------------- Merge preferences & annotate -----------------
//     const annotated = filtered
//       .map((t) => {
//         const pref =
//           (t as any).templatePreferences &&
//           (t as any).templatePreferences.length > 0
//             ? (t as any).templatePreferences[0]
//             : null;
//         const isHidden = pref?.isHidden ?? false;
//         return {
//           id: t.id,
//           name: t.name,
//           slug: t.slug,
//           description: t.description,
//           visibility: t.visibility,
//           accountId: t.accountId,
//           channels: t.channels,
//           subject: t.subject,
//           body: t.body,
//           variables: t.variables,
//           meta: t.meta,
//           isDefault: t.isDefault,
//           lastUsedAt: t.lastUsedAt,
//           isActive: t.isActive,
//           createdAt: t.createdAt,
//           updatedAt: t.updatedAt,
//           // preference annotations
//           prefId: pref?.id ?? null,
//           isPinned: Boolean(pref?.isPinned ?? false),
//           priority: Number(pref?.priority ?? 0),
//           isHidden,
//         };
//       })
//       // remove hidden templates for this account
//       .filter((t) => !t.isHidden);

//     // ----------------- Sorting: pinned first (by priority), then others -----------------
//     annotated.sort((a: any, b: any) => {
//       // pinned first
//       if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;

//       // both pinned: sort by priority
//       if (a.isPinned && b.isPinned) {
//         if (order === "asc") return a.priority - b.priority;
//         return b.priority - a.priority;
//       }

//       // if only sorting explicitly by priority (non-pinned), honor it
//       if (sortBy === "priority") {
//         if (order === "asc") return a.priority - b.priority;
//         return b.priority - a.priority;
//       }

//       // fallback: isDefault, lastUsedAt, createdAt
//       if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
//       const aLast = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
//       const bLast = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
//       if (aLast !== bLast) return bLast - aLast;
//       return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
//     });

//     // ----------------- Pagination -----------------
//     const total = annotated.length;
//     const totalPages = Math.ceil(total / pageSize);
//     const pageStart = (pageNumber - 1) * pageSize;
//     const pageEnd = pageStart + pageSize;
//     const pageItems = annotated.slice(pageStart, pageEnd);

//     return sendSuccessResponse(res, 200, "Templates fetched", {
//       data: pageItems,
//       meta: {
//         page: pageNumber,
//         limit: pageSize,
//         total,
//         totalPages,
//         hasNext: pageNumber < totalPages,
//         hasPrev: pageNumber > 1,
//       },
//     });
//   } catch (err: any) {
//     console.error("listTemplates error:", err);
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to list templates",
//     );
//   }
// }

export async function listTemplates(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const accountId = await getAccountIdFromReqUser(userId);
    // console.log("userId:", userId, "accountId:", accountId);
    

    const {
      q,
      channels,
      pinned,
      visibility,
      sortBy = "priority",
      order = "desc",
      page = "1",
      limit = "20",
      activeOnly = "true",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Number(limit) || 20, 200);

    /* ─────────────────────────────
       BASE VISIBILITY RULE (ALWAYS)
    ───────────────────────────── */

    const and: any[] = [
      {
        OR: [
          { visibility: "PUBLIC" },
          ...(accountId ? [{ visibility: "PRIVATE", accountId }] : []),
        ],
      },
    ];

    /* Active / Inactive */
    if (activeOnly === "true") and.push({ isActive: true });
    else if (activeOnly === "false") and.push({ isActive: false });

    /* Visibility override */
    if (visibility === "PUBLIC") {
      and.push({ visibility: "PUBLIC" });
    } else if (visibility === "PRIVATE") {
      if (!accountId) {
        return sendSuccessResponse(res, 200, "Templates fetched", {
          data: [],
          meta: { page: pageNumber, limit: pageSize, total: 0, totalPages: 0 },
        });
      }
      and.push({ visibility: "PRIVATE", accountId });
    }

    /* Search */
    if (q?.trim()) {
      and.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    /* Pinned filter */
    if (pinned === "true" && accountId) {
      and.push({
        templatePreferences: {
          some: { accountId, isPinned: true },
        },
      });
    }

    const where = { AND: and };
    // console.log("\n\nlistTemplates db where:\n", JSON.stringify(where, null, 2));
    

    const templates = await prisma.messageTemplate.findMany({
      where,
      include: accountId
        ? {
            templatePreferences: {
              where: { accountId },
              select: {
                isPinned: true,
                priority: true,
                isHidden: true,
              },
            },
          }
        : undefined,
      orderBy: [
        { isDefault: "desc" },
        { lastUsedAt: "desc" },
        { createdAt: "desc" },
      ],
    });

    /* Channel filter (safe, JSON-aware) */
    let filtered = templates;
    if (channels) {
      const wanted = channels.startsWith("[")
        ? JSON.parse(channels)
        : channels.split(",").map((c) => c.trim());

      filtered = filtered.filter((t) =>
        Array.isArray(t.channels) &&
        t.channels.some((c) => wanted.includes(String(c))),
      );
    }

    /* Merge preferences */
    const merged = filtered
      .map((t) => {
        const pref = (t as any).templatePreferences?.[0];
        return {
          ...t,
          templatePreferences: undefined,
          isPinned: pref?.isPinned ?? false,
          priority: pref?.priority ?? 0,
          isHidden: pref?.isHidden ?? false,
        };
      })
      .filter((t) => !t.isHidden);

    /* Sorting */
    merged.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isPinned && b.isPinned) {
        return order === "asc"
          ? a.priority - b.priority
          : b.priority - a.priority;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    /* Pagination */
    const total = merged.length;
    const pageItems = merged.slice(
      (pageNumber - 1) * pageSize,
      pageNumber * pageSize,
    );

    return sendSuccessResponse(res, 200, "Templates fetched", {
      data: pageItems,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    console.error("listTemplates error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to list templates");
  }
}


/**
 * GET /api/v1/templates/message/:id
 */
export async function getTemplateById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    console.log("getTemplateById id:", id);
    

    const userId = req.user?.id ?? null;
    const accountId = await getAccountIdFromReqUser(userId);
    const isAdmin = Boolean(req.user?.roles?.includes?.("ADMIN"));

    /* ─────────────────────────────
       Fetch template
    ───────────────────────────── */

    const template = await prisma.messageTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return sendErrorResponse(res, 404, "Template not found");
    }

    /* ─────────────────────────────
       Access control
    ───────────────────────────── */

    // PRIVATE → only owner or admin
    if (
      template.visibility === "PRIVATE" &&
      template.accountId !== accountId &&
      !isAdmin
    ) {
      return sendErrorResponse(res, 403, "Access denied");
    }

    // INACTIVE → only owner or admin
    if (!template.isActive && template.accountId !== accountId && !isAdmin) {
      return sendErrorResponse(res, 403, "Template is inactive");
    }

    /* ─────────────────────────────
       Fetch preference (optional)
    ───────────────────────────── */

    let preference: any = null;

    if (accountId) {
      preference = await prisma.templatePreference.findUnique({
        where: {
          accountId_templateId: {
            accountId,
            templateId: id,
          },
        },
      });
    }

    /* ─────────────────────────────
       Merge derived fields
    ───────────────────────────── */

    const response = {
      ...template,
      isPinned: preference?.isPinned ?? false,
      priority: preference?.priority ?? 0,
      isHidden: preference?.isHidden ?? false,
    };

    return sendSuccessResponse(res, 200, "Template fetched", {
      template: response,
      preference,
    });
  } catch (err: any) {
    console.error("getTemplateById error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch template",
    );
  }
}

/**
 * PATCH /api/v1/templates/message/:id
 */
export async function updateTemplate(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    const isAdmin = Boolean(req.user?.roles?.includes?.("ADMIN"));

    const { id } = req.params;

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) return sendErrorResponse(res, 404, "Template not found");

    /* ─────────────────────────────
       Authorization
    ───────────────────────────── */

    if (template.visibility === "PUBLIC" && !isAdmin) {
      return sendErrorResponse(
        res,
        403,
        "Only admin can update public templates",
      );
    }

    if (
      template.visibility === "PRIVATE" &&
      template.accountId !== accountId &&
      !isAdmin
    ) {
      return sendErrorResponse(
        res,
        403,
        "Not authorized to update this template",
      );
    }

    /* ─────────────────────────────
       Build update payload safely
    ───────────────────────────── */

    const allowedFields = [
      "name",
      "description",
      "channels",
      "subject",
      "body",
      "variables",
      "meta",
      "isActive",
      "isDefault",
      "slug",
    ] as const;

    const data: any = {};

    for (const key of allowedFields) {
      if (req.body[key] === undefined) continue;

      if (["channels", "variables", "meta"].includes(key)) {
        try {
          data[key] =
            typeof req.body[key] === "string"
              ? JSON.parse(req.body[key])
              : req.body[key];
        } catch {
          return sendErrorResponse(res, 400, `Invalid JSON for ${key}`);
        }
      } else {
        data[key] = req.body[key];
      }
    }

    /* ─────────────────────────────
       Slug collision protection
    ───────────────────────────── */

    if (data.slug && data.slug !== template.slug) {
      const exists = await prisma.messageTemplate.findFirst({
        where: {
          slug: data.slug,
          accountId: template.accountId,
          id: { not: id },
        },
        select: { id: true },
      });

      if (exists) {
        return sendErrorResponse(res, 400, "Slug already exists");
      }
    }

    /* ─────────────────────────────
       Default template enforcement
    ───────────────────────────── */

    if (data.isDefault === true) {
      await prisma.messageTemplate.updateMany({
        where: {
          id: { not: id },
          visibility: template.visibility,
          accountId: template.accountId,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.messageTemplate.update({
      where: { id },
      data,
    });

    return sendSuccessResponse(res, 200, "Template updated", updated);
  } catch (err: any) {
    console.error("updateTemplate error:", err);

    if (err?.code === "P2002") {
      return sendErrorResponse(res, 400, "Unique constraint violation");
    }

    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update template",
    );
  }
}

/**
 * DELETE /api/v1/templates/message/:id
 * Soft delete (isActive = false)
 */
export async function deleteTemplate(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    const isAdmin = Boolean(req.user?.roles?.includes?.("ADMIN"));

    const { id } = req.params;

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) return sendErrorResponse(res, 404, "Template not found");

    /* ─────────────────────────────
       Authorization
    ───────────────────────────── */

    if (template.visibility === "PUBLIC" && !isAdmin) {
      return sendErrorResponse(
        res,
        403,
        "Only admin can delete public templates",
      );
    }

    if (
      template.visibility === "PRIVATE" &&
      template.accountId !== accountId &&
      !isAdmin
    ) {
      return sendErrorResponse(
        res,
        403,
        "Not authorized to delete this template",
      );
    }

    await prisma.messageTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    return sendSuccessResponse(res, 200, "Template deactivated");
  } catch (err: any) {
    console.error("deleteTemplate error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete template",
    );
  }
}

/**
 * POST /api/v1/templates/message/:id/pin
 */
export async function pinTemplateForAccount(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const { pin, priority, hide } = req.body as {
      pin?: boolean;
      priority?: number;
      hide?: boolean;
    };

    const isAdmin = Boolean(req.user?.roles?.includes?.("ADMIN"));

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) return sendErrorResponse(res, 404, "Template not found");

    // PRIVATE template access control
    if (
      template.visibility === "PRIVATE" &&
      template.accountId !== accountId &&
      !isAdmin
    ) {
      return sendErrorResponse(res, 403, "Access denied");
    }

    const hasAnyChange =
      pin !== undefined || priority !== undefined || hide !== undefined;

    if (!hasAnyChange) {
      return sendErrorResponse(res, 400, "Nothing to update");
    }

    const pref = await prisma.templatePreference.upsert({
      where: {
        accountId_templateId: { accountId, templateId: id },
      },
      create: {
        accountId,
        templateId: id,
        isPinned: pin ?? false,
        priority: priority ?? 0,
        isHidden: hide ?? false,
      },
      update: {
        ...(pin !== undefined && { isPinned: pin }),
        ...(priority !== undefined && { priority }),
        ...(hide !== undefined && { isHidden: hide }),
      },
    });

    return sendSuccessResponse(res, 200, "Preference saved", pref);
  } catch (err: any) {
    console.error("pinTemplateForAccount error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to save preference",
    );
  }
}

/**
 * POST /api/v1/templates/message/:id/visibility
 */
export async function setTemplateVisibility(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;
    const { visibility } = req.body as { visibility?: "PUBLIC" | "PRIVATE" };

    if (!visibility) {
      return sendErrorResponse(res, 400, "visibility required");
    }

    const accountId = await getAccountIdFromReqUser(userId);
    const isAdmin = Boolean(req.user?.roles?.includes?.("ADMIN"));

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) return sendErrorResponse(res, 404, "Template not found");

    // PUBLIC requires admin
    if (visibility === "PUBLIC" && !isAdmin) {
      return sendErrorResponse(
        res,
        403,
        "Admin access required to publish template",
      );
    }

    // PRIVATE ownership check
    if (
      template.visibility === "PRIVATE" &&
      template.accountId !== accountId &&
      !isAdmin
    ) {
      return sendErrorResponse(res, 403, "Not authorized");
    }

    const updated = await prisma.messageTemplate.update({
      where: { id },
      data: {
        visibility,
        accountId: visibility === "PRIVATE" ? accountId : null,
      },
    });

    return sendSuccessResponse(
      res,
      200,
      "Template visibility updated",
      updated,
    );
  } catch (err: any) {
    console.error("setTemplateVisibility error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update visibility",
    );
  }
}

/**
 * POST /api/v1/templates/message/:id/activate
 */
export async function setTemplateActive(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;
    const { active } = req.body as { active?: boolean };

    if (typeof active !== "boolean") {
      return sendErrorResponse(res, 400, "active must be boolean");
    }

    const accountId = await getAccountIdFromReqUser(userId);
    const isAdmin = Boolean(req.user?.roles?.includes?.("ADMIN"));

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) return sendErrorResponse(res, 404, "Template not found");

    if (template.visibility === "PUBLIC" && !isAdmin) {
      return sendErrorResponse(
        res,
        403,
        "Only admin can activate/deactivate public templates",
      );
    }

    if (
      template.visibility === "PRIVATE" &&
      template.accountId !== accountId &&
      !isAdmin
    ) {
      return sendErrorResponse(res, 403, "Not authorized");
    }

    const updated = await prisma.messageTemplate.update({
      where: { id },
      data: { isActive: active },
    });

    return sendSuccessResponse(
      res,
      200,
      "Template active state updated",
      updated,
    );
  } catch (err: any) {
    console.error("setTemplateActive error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update active state",
    );
  }
}
