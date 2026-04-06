// src/controller/user/lead.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import {
  buildCustomerProductEntries,
  deriveLeadScalars,
  normalizeIncomingProducts,
} from "../../core/utils/leadProducts";
import { triggerHelperNotification } from "../../services/notifications";
import { findDuplicateLead } from "../../services/lead/lead.service";

/**
 * Helpers (kept local so this file is self-contained)
 */
const normalizeMobile = (m: unknown) => String(m ?? "").replace(/\D/g, "");

async function resolveAssigneeSnapshot(input: {
  accountId?: string | null;
  teamId?: string | null;
}) {
  if (input.accountId) {
    const acc = await prisma.account.findUnique({
      where: { id: input.accountId },
      select: { id: true, firstName: true, lastName: true },
    });
    return acc
      ? {
        type: "ACCOUNT",
        id: acc.id,
        name: `${acc.firstName} ${acc.lastName}`,
      }
      : null;
  }

  if (input.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: input.teamId },
      select: { id: true, name: true },
    });
    return team ? { type: "TEAM", id: team.id, name: team.name } : null;
  }

  return null;
}

async function resolvePerformerSnapshot(accountId: string | null) {
  if (!accountId) return null;
  const acc = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      designation: true,
      contactPhone: true,
    },
  });

  if (!acc) return null;

  return {
    id: acc.id,
    name: `${acc.firstName} ${acc.lastName}`,
    designation: acc.designation ?? null,
    contactPhone: acc.contactPhone ?? null,
  };
}

async function assertLeadAccessForUser(leadId: string, accountId: string) {
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      assignments: {
        some: {
          isActive: true,
          OR: [
            { accountId },
            {
              team: {
                members: {
                  some: { accountId },
                },
              },
            },
          ],
        },
      },
    },
    select: { id: true },
  });

  if (!lead) {
    throw new Error("ACCESS_DENIED");
  }

  return lead;
}

async function stopWorkIfActive(tx: any, accountId: string, leadId: string) {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { activeLeadId: true },
  });

  // Only stop if user is working on THIS lead
  if (account?.activeLeadId !== leadId) return;

  const lastStart = await tx.leadActivityLog.findFirst({
    where: {
      leadId,
      performedBy: accountId,
      action: "WORK_STARTED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!lastStart) return;

  const now = new Date();
  const startedAtIso =
    (lastStart.meta as any)?.startedAt ?? lastStart.createdAt.toISOString();

  const durationSeconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(startedAtIso).getTime()) / 1000),
  );

  // WORK_ENDED log
  await tx.leadActivityLog.create({
    data: {
      leadId,
      action: "WORK_ENDED",
      performedBy: accountId,
      meta: {
        startedAt: startedAtIso,
        endedAt: now.toISOString(),
        durationSeconds,
        reason: "LEAD_STATUS_TERMINAL",
      },
    },
  });

  // increment lead work time
  await tx.lead.update({
    where: { id: leadId },
    data: {
      totalWorkSeconds: { increment: durationSeconds },
      isWorking: false,
    },
  });

  // clear busy state.   const Acc =
  await tx.account.update({
    where: { id: accountId },
    data: {
      isBusy: false,
      activeLeadId: null,
    },
  });

  // console.log("\n\n\n\n\n\nAcc\n", Acc, "\n\n\n\n\n\n\n");

  const io = getIo();
  io.emit("busy:changed", {
    accountId,
    leadId: leadId,
    isBusy: false,
    source: "WORK_ENDED",
  });
}

async function closeFollowUpsOnStatusChange(
  tx: any,
  leadId: string,
  newStatus: string,
  accountId: string,
): Promise<void> {
  const now = new Date();

  // DEMO_DONE → mark only DEMO-type follow-ups as done
  if (newStatus === "DEMO_DONE") {
    const pendingDemoFollowUps = await tx.leadFollowUp.findMany({
      where: {
        leadId,
        status: "PENDING",
        type: "DEMO",
      },
      select: { id: true, scheduledAt: true },
    });

    if (pendingDemoFollowUps.length > 0) {
      await tx.leadFollowUp.updateMany({
        where: {
          leadId,
          status: "PENDING",
          type: "DEMO",
        },
        data: {
          status: "DONE",
          doneAt: now,
          doneBy: accountId,
          remark: "Auto-marked done: Lead status changed to DEMO_DONE",
        },
      });
    }

    return; // only demo follow-ups affected
  }

  // CLOSED or CONVERTED → mark ALL pending follow-ups as done
  if (newStatus === "CLOSED" || newStatus === "CONVERTED") {
    const pendingFollowUps = await tx.leadFollowUp.findMany({
      where: {
        leadId,
        status: "PENDING",
      },
      select: { id: true },
    });

    if (pendingFollowUps.length > 0) {
      await tx.leadFollowUp.updateMany({
        where: {
          leadId,
          status: "PENDING",
        },
        data: {
          status: "DONE",
          doneAt: now,
          doneBy: accountId,
          remark: `Auto-marked done: Lead status changed to ${newStatus}`,
        },
      });
    }
  }
}

/* ==========================
   USER (EMPLOYEE) CONTROLLER
   ========================== */

/**
 * POST user/leads/my
 * User creates lead and auto-assigns to self
 */
// export async function createMyLead(req: Request, res: Response) {
//   try {
//     const accountId = req.user?.accountId;
//     if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

//     const {
//       source = "MANUAL",
//       type = "LEAD",
//       customerName,
//       mobileNumber,
//       product,
//       productTitle,
//       cost,
//       remark,
//       demoDate,
//       followUps,
//     } = req.body as Record<string, any>;

//     if (!customerName || !mobileNumber)
//       return sendErrorResponse(
//         res,
//         400,
//         "Customer name and mobile are required",
//       );

//     const normalizedMobile = normalizeMobile(mobileNumber);

//     const resolvedProduct = product
//       ? {
//           id: product.id || randomUUID(),
//           slug: product.slug ?? null,
//           link: product.link ?? null,
//           title: product.title ?? null,
//         }
//       : undefined;

//     const finalProductTitle = resolvedProduct?.title ?? productTitle ?? null;

//     const now = new Date();

//     const { newLead, createdFollowUps } = await prisma.$transaction(
//       async (tx) => {
//         /* -------------------------
//      1️⃣ Upsert Customer
//   ------------------------- */
//         const customer = await tx.customer.upsert({
//           where: { normalizedMobile },
//           create: {
//             name: customerName,
//             mobile: mobileNumber,
//             normalizedMobile,
//             createdBy: accountId,
//           },
//           update: { name: customerName },
//         });

//         /* -------------------------
//      2️⃣ Create Lead
//   ------------------------- */
//         const lead = await tx.lead.create({
//           data: {
//             source,
//             type,
//             customerId: customer.id,
//             customerName,
//             mobileNumber: normalizedMobile,
//             product: resolvedProduct,
//             productTitle: finalProductTitle,
//             cost: cost ?? undefined,
//             remark: remark ?? undefined,
//             createdBy: accountId,
//             demoScheduledAt: demoDate ? new Date(demoDate) : undefined,
//             demoCount: demoDate ? 1 : 0,
//             demoMeta: demoDate
//               ? {
//                   history: [
//                     {
//                       type: "SCHEDULED",
//                       at: new Date(demoDate),
//                       by: accountId,
//                     },
//                   ],
//                 }
//               : undefined,
//           },
//         });

//         /* -------------------------
//      3️⃣ Self Assignment
//   ------------------------- */
//         await tx.leadAssignment.create({
//           data: {
//             leadId: lead.id,
//             type: "ACCOUNT",
//             accountId,
//             isActive: true,
//             assignedBy: accountId,
//             assignedAt: now,
//           },
//         });

//         /* -------------------------
//      4️⃣ Activity Log
//   ------------------------- */
//         const initialAssignee = await resolveAssigneeSnapshot({ accountId });

//         await tx.leadActivityLog.create({
//           data: {
//             leadId: lead.id,
//             action: "CREATED",
//             performedBy: accountId,
//             meta: {
//               source,
//               type,
//               selfAssigned: true,
//               initialAssignment: initialAssignee,
//               demoScheduledAt: demoDate ?? null,
//             },
//           },
//         });

//         /* -------------------------
//      5️⃣ Follow-ups
//   ------------------------- */
//         let createdFollowUps: any[] = [];

//         if (Array.isArray(followUps) && followUps.length > 0) {
//           const invalid = followUps.some((f) => !f.scheduledAt);
//           if (invalid)
//             throw new Error("Each follow-up must have a scheduledAt");

//           await tx.leadFollowUp.createMany({
//             data: followUps.map((f) => ({
//               leadId: lead.id,
//               type: f.type ?? "CALL",
//               status: "PENDING" as const,
//               scheduledAt: new Date(f.scheduledAt),
//               remark: f.remark ?? null,
//               createdBy: accountId,
//             })),
//           });

//           createdFollowUps = await tx.leadFollowUp.findMany({
//             where: { leadId: lead.id },
//             orderBy: { scheduledAt: "asc" },
//           });

//           await tx.lead.update({
//             where: { id: lead.id },
//             data: {
//               followUpCount: createdFollowUps.length,
//               nextFollowUpAt: createdFollowUps[0].scheduledAt,
//             },
//           });

//           await tx.leadActivityLog.create({
//             data: {
//               leadId: lead.id,
//               action: "FOLLOW_UP_SCHEDULED",
//               performedBy: accountId,
//               meta: {
//                 count: createdFollowUps.length,
//                 followUps: createdFollowUps.map((f) => ({
//                   id: f.id,
//                   type: f.type,
//                   scheduledAt: f.scheduledAt,
//                 })),
//               },
//             },
//           });
//         }

//         return { newLead: lead, createdFollowUps };
//       },
//     );

//     /* -------------------------
//        🔔 Socket Emit (Minimal)
//     ------------------------- */

//     try {
//       const io = getIo();

//       const payload = {
//         id: newLead.id,
//         customerName: newLead.customerName,
//         status: newLead.status,
//         demoScheduledAt: newLead.demoScheduledAt,
//         createdAt: newLead.createdAt,
//       };

//       io.to(`leads:user:${accountId}`).emit("lead:created", payload);
//       io.to("leads:admin").emit("lead:created", payload);
//     } catch {
//       console.warn("Socket emit skipped");
//     }

//     return sendSuccessResponse(res, 201, "Lead created and assigned to you", {
//       ...newLead,
//       followUps: createdFollowUps,
//     });
//   } catch (err: any) {
//     console.error("Create my lead error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to create lead");
//   }
// }

/**
 * POST user/leads/my
 * User creates lead and auto-assigns to self
 */
export async function createMyLead(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      source = "MANUAL",
      type = "LEAD",
      customerName,
      mobileNumber,
      customerCompanyName,
      cost,
      remark,
      demoDate,
      followUps,
      customerCategory,
      businessCategory,
      state,
      city,
      isImportant,
      forceCreate = false,
    } = req.body as Record<string, any>;

    if (!customerName || !mobileNumber)
      return sendErrorResponse(
        res,
        400,
        "Customer name and mobile are required",
      );

    const normalizedMobile = normalizeMobile(mobileNumber);

    // ── Normalise products ────────────────────────────────────────────────────
    const products = normalizeIncomingProducts(req.body);
    const { productTitle, totalCost } = deriveLeadScalars(products, cost);

    // ── DUPLICATE CHECK ──────────────────────────────────────────────────────
    if (!forceCreate) {
      const duplicate = await findDuplicateLead({ normalizedMobile, productTitle });
 
      if (duplicate) {
        const assigneeName = duplicate.assignments[0]?.account
          ? `${duplicate.assignments[0].account.firstName} ${duplicate.assignments[0].account.lastName}`.trim()
          : null;
 
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_LEAD",
          message: "An active lead already exists for this customer and product.",
          data: {
            existingLead: {
              id: duplicate.id,
              status: duplicate.status,
              customerName: duplicate.customerName,
              productTitle: duplicate.productTitle,
              createdAt: duplicate.createdAt,
              assignedTo: assigneeName,
            },
            hint: "Send { forceCreate: true } to create anyway.",
          },
        });
      }
    }

    const now = new Date();

    const { newLead, createdFollowUps } = await prisma.$transaction(
      async (tx) => {
        // ── 1. Upsert Customer ──────────────────────────────────────────────────
        let customer = await tx.customer.findUnique({
          where: { normalizedMobile },
        });

        if (customer) {
          const existingProducts: any = customer.products ?? {
            active: [],
            history: [],
          };
          if (!Array.isArray(existingProducts.active))
            existingProducts.active = [];

          if (products && products.length > 0) {
            for (const entry of buildCustomerProductEntries(products)) {
              const alreadyExists = existingProducts.active.some(
                (p: any) => p.id === entry.id || p.name === entry.name,
              );
              if (!alreadyExists) existingProducts.active.push(entry);
            }
            customer = await tx.customer.update({
              where: { id: customer.id },
              data: {
                name: customerName || customer.name,
                customerCompanyName:
                  customerCompanyName || customer.customerCompanyName,
                ...(customerCategory && { customerCategory }),
                ...(businessCategory && { businessCategory }),
                ...(state && { state }),
                ...(city && { city }),
                products: existingProducts,
                updatedAt: new Date(),
              },
            });
          } else {
            customer = await tx.customer.update({
              where: { id: customer.id },
              data: {
                name: customerName,
                customerCompanyName:
                  customerCompanyName || customer.customerCompanyName,
                ...(customerCategory && { customerCategory }),
                ...(businessCategory && { businessCategory }),
                ...(state && { state }),
                ...(city && { city }),
              },
            });
          }
        } else {
          const customerProducts =
            products && products.length > 0
              ? { active: buildCustomerProductEntries(products), history: [] }
              : undefined;

          customer = await tx.customer.create({
            data: {
              name: customerName,
              mobile: mobileNumber,
              customerCompanyName: customerCompanyName,
              normalizedMobile,
              createdBy: accountId,
              products: customerProducts,
              customerCategory: customerCategory ?? undefined,
              businessCategory: businessCategory ?? undefined,
              state: state ?? undefined,
              city: city ?? undefined,
              joiningDate: new Date(),
            },
          });
        }

        // ── 2. Create Lead ──────────────────────────────────────────────────────
        const lead = await tx.lead.create({
          data: {
            source,
            type,
            customerId: customer.id,
            customerName,
            mobileNumber: normalizedMobile,
            product: (products && products.length > 0
              ? products.length === 1
                ? products[0]
                : products
              : undefined) as any,
            productTitle: productTitle ?? undefined,
            cost: totalCost ?? undefined,
            remark: remark ?? undefined,
            isImportant: isImportant === true,
            createdBy: accountId,
            demoScheduledAt: demoDate ? new Date(demoDate) : undefined,
            demoCount: demoDate ? 1 : 0,
            demoMeta: demoDate
              ? {
                history: [
                  {
                    type: "SCHEDULED",
                    at: new Date(demoDate),
                    by: accountId,
                  },
                ],
              }
              : undefined,
          },
        });

        // ── 3. Self-assignment ──────────────────────────────────────────────────
        await tx.leadAssignment.create({
          data: {
            leadId: lead.id,
            type: "ACCOUNT",
            accountId,
            isActive: true,
            assignedBy: accountId,
            assignedAt: now,
          },
        });

        // ── 4. Activity log ─────────────────────────────────────────────────────
        const initialAssignee = await resolveAssigneeSnapshot({ accountId });
        await tx.leadActivityLog.create({
          data: {
            leadId: lead.id,
            action: "CREATED",
            performedBy: accountId,
            meta: {
              source,
              type,
              selfAssigned: true,
              initialAssignment: initialAssignee,
              demoScheduledAt: demoDate ?? null,
              products: products ? JSON.parse(JSON.stringify(products)) : null,
               forcedDuplicate: forceCreate || undefined,
            },
          },
        });

        // ── 5. Follow-ups ───────────────────────────────────────────────────────
        let createdFollowUps: any[] = [];

        if (Array.isArray(followUps) && followUps.length > 0) {
          const invalid = followUps.some((f) => !f.scheduledAt);
          if (invalid)
            throw new Error("Each follow-up must have a scheduledAt");

          await tx.leadFollowUp.createMany({
            data: followUps.map((f) => ({
              leadId: lead.id,
              type: f.type ?? "CALL",
              status: "PENDING" as const,
              scheduledAt: new Date(f.scheduledAt),
              remark: f.remark ?? null,
              createdBy: accountId,
            })),
          });

          createdFollowUps = await tx.leadFollowUp.findMany({
            where: { leadId: lead.id },
            orderBy: { scheduledAt: "asc" },
          });

          await tx.lead.update({
            where: { id: lead.id },
            data: {
              followUpCount: createdFollowUps.length,
              nextFollowUpAt: createdFollowUps[0].scheduledAt,
            },
          });

          await tx.leadActivityLog.create({
            data: {
              leadId: lead.id,
              action: "FOLLOW_UP_SCHEDULED",
              performedBy: accountId,
              meta: {
                count: createdFollowUps.length,
                followUps: createdFollowUps.map((f) => ({
                  id: f.id,
                  type: f.type,
                  scheduledAt: f.scheduledAt,
                })),
              },
            },
          });
        }

        return { newLead: lead, createdFollowUps };
      },
    );

    // ── Socket ────────────────────────────────────────────────────────────────
    try {
      const io = getIo();
      const payload = {
        id: newLead.id,
        customerName: newLead.customerName,
        productTitle: newLead.productTitle,
        status: newLead.status,
        demoScheduledAt: newLead.demoScheduledAt,
        createdAt: newLead.createdAt,
      };
      io.to(`leads:user:${accountId}`).emit("lead:created", payload);
      io.to("leads:admin").emit("lead:created", payload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Lead created and assigned to you", {
      ...newLead,
      followUps: createdFollowUps,
    });
  } catch (err: any) {
    console.error("Create my lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create lead");
  }
}

/**
 * PATCH user/leads/my/:id/status
 * Update status/remark as the assignee (account or team member)
 */
export async function updateMyLeadStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status, remark, cost, customerName, demoScheduledAt, isImportant } =
      req.body as {
        status?:
        | "PENDING"
        | "IN_PROGRESS"
        | "CLOSED"
        | "CONVERTED"
        | "DEMO_DONE"
        | "FOLLOW_UPS"
        | "INTERESTED";
        remark?: string;
        cost?: number;
        customerName?: string;
        demoScheduledAt?: string;
        isImportant?: boolean;
      };
    // console.log("\n\n\n\n\n\n\n\n\n\n req.body:\n", req.body);


    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const TERMINAL_STATUSES = [
      "CLOSED",
      "DEMO_DONE",
      "CONVERTED",
      "FOLLOW_UPS",
      "PENDING",
    ] as const;

    const isTerminalStatus =
      typeof status !== "undefined" &&
      TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number]);

    // console.log("\n\n\nisTerminalStatus\n", isTerminalStatus);

    // verify access: ensure the lead is currently assigned to this user (directly or via team)
    // const lead = await prisma.lead.findFirst({
    //   where: {
    //     id,
    //     assignments: {
    //       some: {
    //         isActive: true,
    //         OR: [
    //           { accountId: accountId },
    //           {
    //             team: {
    //               members: {
    //                 some: { accountId: accountId },
    //               },
    //             },
    //           },
    //         ],
    //       },
    //     },
    //   },
    // });
    const lead = await prisma.lead.findFirst({
      where: {
        id,
        OR: [
          {
            assignments: {
              some: {
                isActive: true,
                OR: [
                  { accountId },
                  {
                    team: {
                      members: {
                        some: { accountId },
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            leadHelpers: {
              some: {
                isActive: true,
                accountId,
              },
            },
          },
        ],
      },
    });

    // console.log("\n\n\n\nLEAD\n", lead);

    if (!lead) return sendErrorResponse(res, 403, "Access denied");

    const performerSnapshot = await resolvePerformerSnapshot(accountId);

    const updated = await prisma.$transaction(async (tx) => {
      // prepare update payload
      const data: any = {};
      if (typeof status !== "undefined") data.status = status;
      if (typeof remark !== "undefined") data.remark = remark;
      if (typeof cost !== "undefined") data.cost = cost;
      if (typeof customerName !== "undefined") data.customerName = customerName;
      if (data.status === "CLOSED" || data.status === "CONVERTED") {
        data.closedAt = new Date();
      }
      if (typeof isImportant !== "undefined") data.isImportant = isImportant;
      // prepare statusMark safely
      const statusMark = {
        ...(lead.statusMark as Record<string, boolean> | null),
      };

      if (status === "CLOSED") {
        statusMark.close = true;
      }

      if (status === "DEMO_DONE") {
        statusMark.demo = true;
        data.demoDoneAt = new Date();
      }

      if (status === "CONVERTED") {
        statusMark.converted = true;
        data.closedAt = new Date();
      }

      // only assign if something changed
      if (Object.keys(statusMark).length > 0) {
        data.statusMark = statusMark;
      }

      if (isTerminalStatus) {
        await stopWorkIfActive(tx, accountId, id);
        // close relevant follow-ups based on new status
        if (status === "DEMO_DONE" || status === "CLOSED" || status === "CONVERTED") {
          await closeFollowUpsOnStatusChange(tx, id, status, accountId);
          // re-sync lead aggregates after bulk follow-up update
          await syncLeadFollowUpAggregates(tx, id);
        }
      }

      // ── demo scheduling / rescheduling ───────────────────────────────────
      if (demoScheduledAt !== undefined) {
        const newDate = new Date(demoScheduledAt);

        const isNewDate =
          !lead.demoScheduledAt ||
          lead.demoScheduledAt.getTime() !== newDate.getTime();

        if (isNewDate) {
          data.demoScheduledAt = newDate;
          data.demoCount = { increment: 1 };

          // append to demoMeta.history
          const existingMeta = lead.demoMeta as any;
          const history: any[] = existingMeta?.history ?? [];
          data.demoMeta = {
            history: [
              ...history,
              {
                type: lead.demoScheduledAt ? "RESCHEDULED" : "SCHEDULED",
                at: newDate.toISOString(),
                by: accountId,
              },
            ],
          };
        }
      }

      // perform update
      const updatedLead = await tx.lead.update({
        where: { id },
        data,
        include: {
          assignments: {
            include: {
              account: true,
              team: true,
            },
          },
        },
      });

      // build snapshots and diffs
      const fromState = {
        id: lead.id,
        status: lead.status,
        remark: lead.remark ?? null,
        cost: lead.cost ?? null,
        customerName: lead.customerName ?? null,
        isImportant: lead.isImportant,
      };

      const toState = {
        id: updatedLead.id,
        status: updatedLead.status,
        remark: updatedLead.remark ?? null,
        cost: updatedLead.cost ?? null,
        customerName: updatedLead.customerName ?? null,
        isImportant: updatedLead.isImportant,
      };

      // console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n lead-->\n", lead);
      // console.log("\n updatedLead-->\n", updatedLead);
      // console.log("\n fromState-->\n", fromState);
      // console.log("\n toState-->\n", toState);
      // console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n");

      // Detect what changed
      const changedFields: Record<string, { from: any; to: any }> = {};
      if (fromState.status !== toState.status)
        changedFields.status = { from: fromState.status, to: toState.status };
      if ((fromState.remark ?? null) !== (toState.remark ?? null))
        changedFields.remark = { from: fromState.remark, to: toState.remark };
      if (fromState.isImportant !== toState.isImportant)
        changedFields.isImportant = { from: fromState.isImportant, to: toState.isImportant };
      // careful with Decimal types — convert to string/number for comparison
      const prevCost = fromState.cost == null ? null : Number(fromState.cost);
      const newCost = toState.cost == null ? null : Number(toState.cost);
      if (prevCost !== newCost)
        changedFields.cost = { from: prevCost, to: newCost };
      if ((fromState.customerName ?? null) !== (toState.customerName ?? null))
        changedFields.customerName = {
          from: fromState.customerName,
          to: toState.customerName,
        };

      // Create activity logs depending on changes
      // 1) STATUS_CHANGED (if status changed)

      if (changedFields.status) {
        await tx.leadActivityLog.create({
          data: {
            leadId: id,
            action: "STATUS_CHANGED",
            performedBy: accountId,
            meta: {
              fromState: lead,
              toState: updatedLead,
            },
          },
        });
      }

      // 2) UPDATED (if non-status fields changed: cost, customerName, remark)
      const nonStatusKeys = ["cost", "customerName", "remark"];
      const hasNonStatusChange = nonStatusKeys.some((k) =>
        Object.prototype.hasOwnProperty.call(changedFields, k),
      );
      if (hasNonStatusChange) {
        // include only the changed fields in meta to keep payload compact
        const changes: Record<string, any> = {};
        for (const k of nonStatusKeys) {
          if (changedFields[k]) changes[k] = changedFields[k];
        }

        await tx.leadActivityLog.create({
          data: {
            leadId: id,
            action: "UPDATED",
            performedBy: accountId,
            meta: {
              fromState: lead,
              toState: updatedLead,
            },
          },
        });
      }

      // 3) CLOSED (if lead became CLOSED) — separate explicit log because frontend may want to trigger specific flows on this
      const becameClosed =
        changedFields.status && changedFields.status.to === "CLOSED";

      if (becameClosed) {
        await tx.leadActivityLog.create({
          data: {
            leadId: id,
            action: "CLOSED",
            performedBy: accountId,
            meta: {
              closedBy: performerSnapshot,
              closedAt: new Date().toISOString(),
            },
          },
        });
      }

      return updatedLead;
    });

    try {
      const io = getIo();

      const patchPayload = {
        id,
        patch: {
          status: updated.status,
          demoDoneAt: updated.demoDoneAt,
          updatedAt: updated.updatedAt,
          isImportant: updated.isImportant,
          remark: updated.remark,
          cost: updated.cost,
          customerName: updated.customerName,
          productTitle: updated.productTitle,
          product: updated.product,
        },
      };

      io.to(`leads:user:${accountId}`).emit("lead:patch", patchPayload);
      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Lead updated", updated);
  } catch (err: any) {
    console.error("Update lead status error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update lead");
  }
}

/**
 * GET user/leads/my
 * List leads assigned to the current user's account or teams
 */
export async function listMyLeads(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const {
      status,
      source,
      search,
      fromDate,
      toDate,
      sortBy = "createdAt",
      demoFromDate,
      demoToDate,
      demoStatus,
      page = "1",
      limit = "20",
      followUpStatus, // PENDING | DONE | MISSED | RESCHEDULED
      followUpType, // CALL | DEMO | MEETING | VISIT | WHATSAPP | OTHER
      followUpRange, // today | tomorrow | week | overdue | upcoming | custom
      followUpFromDate,
      followUpToDate,
      isImportant,
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    const where: any = {
      OR: [
        {
          assignments: {
            some: {
              isActive: true,
              OR: [
                { accountId },
                {
                  team: {
                    members: {
                      some: { accountId },
                    },
                  },
                },
              ],
            },
          },
        },
        {
          leadHelpers: {
            some: {
              isActive: true,
              accountId,
            },
          },
        },

      ],
    };

    if (status) where.status = status;
    if (source) where.source = source;
    if (isImportant === "true") where.isImportant = true;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
      if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
    }

    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { customerName: { contains: search, mode: "insensitive" } },
            { customerCompanyName: { contains: search, mode: "insensitive" } },
            { mobileNumber: { contains: search } },
            { productTitle: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    if (demoFromDate || demoToDate) {
      where.demoScheduledAt = {};
      if (demoFromDate) where.demoScheduledAt.gte = new Date(demoFromDate);
      if (demoToDate) where.demoScheduledAt.lte = new Date(demoToDate);
    }

    if (demoStatus) {
      const now = new Date();

      if (demoStatus === "overdue") {
        where.demoScheduledAt = { lt: now };
        where.demoDoneAt = null;
      }

      if (demoStatus === "upcoming") {
        where.demoScheduledAt = { gt: now };
        where.demoDoneAt = null;
      }

      if (demoStatus === "done") {
        where.demoDoneAt = { not: null };
      }
    }

    /* -------------------------------------------------------
       ✅ FOLLOW-UP FILTERS
       Filters leads that HAVE a matching follow-up
    ------------------------------------------------------- */
    if (
      followUpStatus ||
      followUpType ||
      followUpRange ||
      followUpFromDate ||
      followUpToDate
    ) {
      const followUpWhere: any = {};

      // status filter
      if (followUpStatus) followUpWhere.status = followUpStatus;

      // type filter
      if (followUpType) followUpWhere.type = followUpType;

      // date range filter
      if (followUpRange) {
        const now = new Date();

        if (followUpRange === "today") {
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          const end = new Date(now);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt = { gte: start, lte: end };
        } else if (followUpRange === "tomorrow") {
          const start = new Date(now);
          start.setDate(start.getDate() + 1);
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt = { gte: start, lte: end };
        } else if (followUpRange === "week") {
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          const end = new Date(now);
          end.setDate(end.getDate() + 7);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt = { gte: start, lte: end };
        } else if (followUpRange === "overdue") {
          followUpWhere.status = "PENDING";
          followUpWhere.scheduledAt = { lt: now };
        } else if (followUpRange === "upcoming") {
          followUpWhere.status = "PENDING";
          followUpWhere.scheduledAt = { gt: now };
        } else if (followUpRange === "custom") {
          followUpWhere.scheduledAt = {};
          if (followUpFromDate)
            followUpWhere.scheduledAt.gte = new Date(followUpFromDate);
          if (followUpToDate) {
            const end = new Date(followUpToDate);
            end.setHours(23, 59, 59, 999);
            followUpWhere.scheduledAt.lte = end;
          }
        }
      } else if (followUpFromDate || followUpToDate) {
        // custom range without followUpRange=custom
        followUpWhere.scheduledAt = {};
        if (followUpFromDate)
          followUpWhere.scheduledAt.gte = new Date(followUpFromDate);
        if (followUpToDate) {
          const end = new Date(followUpToDate);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt.lte = end;
        }
      }

      // attach to lead where: lead must have at least one matching follow-up
      where.followUps = { some: followUpWhere };
    }

    const orderBy = [
      { isWorking: "desc" as const }, // indexed boolean
      { status: "asc" as const }, // enum index
      { createdAt: "desc" as const }, // btree index
    ];

    // console.log(
    //   "\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nfromDate",
    //   fromDate,
    // );
    // console.log("\ntoDate", toDate);

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  contactPhone: true,
                },
              },
              team: { select: { id: true, name: true } },
            },
          },
          leadHelpers: {
            where: { isActive: true },
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  designation: true,
                  contactPhone: true,
                },
              },
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              mobile: true,
              customerCompanyName: true,
              products: true,
              customerCategory: true,
            },
          },
          followUps: {
            where: { status: "PENDING" },
            orderBy: { scheduledAt: "asc" },
            // take: 1,
            select: {
              id: true,
              type: true,
              status: true,
              scheduledAt: true,
              remark: true,
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
    ]);

    const enriched = leads.map((lead) => ({
      ...lead,
      isHelper: lead.leadHelpers.length > 0,
      isAssigned: lead.assignments.some(
        (a) => a.accountId === accountId || a.teamId !== null, // already filtered by team membership
      ),
    }));

    return sendSuccessResponse(res, 200, "My leads fetched", {
      data: enriched,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: pageNumber * pageSize < total,
        hasPrev: pageNumber > 1,
      },
    });
  } catch (err: any) {
    console.error("List my leads error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch leads");
  }
}

/**
 * GET /leads/my/:id
 * Get lead detail visible to current assignee (includes assignments history & activity summary)
 */
export async function getMyLeadById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return sendErrorResponse(res, 400, "Lead ID required");

    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const lead = await prisma.lead.findFirst({
      where: {
        id,
        OR: [
          {
            assignments: {
              some: {
                isActive: true,
                OR: [
                  { accountId },
                  {
                    team: {
                      members: {
                        some: { accountId },
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            leadHelpers: {
              some: {
                isActive: true,
                accountId,
              },
            },
          },
        ],
      },

      include: {
        // include all assignments (active + history) so UI can show reassign history
        assignments: {
          orderBy: { assignedAt: "desc" },
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                contactPhone: true,
                designation: true,
                avatar: true,
              },
            },
            team: { select: { id: true, name: true } },
            assignedByAcc: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        activity: {
          orderBy: { createdAt: "desc" },
          take: 100, // limit to latest 100 for payload safety
          include: {
            performedByAccount: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                contactPhone: true,
              },
            },
          },
        },
        leadHelpers: {
          where: { isActive: true },
          select: {
            role: true,
            remark: true,
            addedAt: true,
            isActive: true,
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                contactPhone: true,
                avatar: true,
              },
            },
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            customerCompanyName: true,
            products: true,
            customerCategory: true,
          },
        },
      },
    });

    // console.log("\n\n\n\n\n\n\n\n\n\n\n lead", lead);


    if (!lead)
      return sendErrorResponse(res, 404, "Lead not found or not accessible");

    return sendSuccessResponse(res, 200, "Lead fetched", lead);
  } catch (err: any) {
    console.error("Get my lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead");
  }
}

/**
 * GET /leads/my/:id/activity
 * Get activity timeline for a lead (only if user has access)
 */
export async function getMyLeadActivity(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const accountId = req.user?.accountId;
    if (!accountId || !id)
      return sendErrorResponse(res, 401, "Invalid session user");

    // const hasAccess = await prisma.lead.findFirst({
    //   where: {
    //     id,
    //     assignments: {
    //       some: {
    //         isActive: true,
    //         OR: [
    //           { accountId: accountId },
    //           {
    //             team: {
    //               members: {
    //                 some: { accountId: accountId },
    //               },
    //             },
    //           },
    //         ],
    //       },
    //     },
    //     leadHelpers: {
    //       some: {
    //         isActive: true,
    //         accountId,
    //       },
    //     },
    //   },
    //   select: { id: true },
    // });
    const hasAccess = await prisma.lead.findFirst({
      where: {
        id,
        OR: [
          {
            assignments: {
              some: {
                isActive: true,
                OR: [
                  { accountId },
                  {
                    team: {
                      members: {
                        some: { accountId },
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            leadHelpers: {
              some: {
                isActive: true,
                accountId,
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (!hasAccess) return sendErrorResponse(res, 403, "Access denied");

    const activity = await prisma.leadActivityLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
      include: {
        performedByAccount: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            contactPhone: true,
          },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Activity fetched", activity);
  } catch (err: any) {
    console.error("Get my lead activity error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch activity",
    );
  }
}

/**
 * GET /leads/my/dsu
 * Employee DSU view:
 * - Pending & In-Progress → all
 * - Closed & Converted → today only
 */
export async function listMyDsuLeads(req: Request, res: Response) {
  try {
    const accountId = await req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const {
      search,
      source,
      sortBy = "updatedAt",
      sortOrder = "desc",
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);

    /** Today window */
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    /** Base assignment scope */
    const where: any = {
      isActive: true,
      assignments: {
        some: {
          isActive: true,
          OR: [
            { accountId },
            {
              team: {
                members: {
                  some: { accountId },
                },
              },
            },
          ],
        },
      },
      OR: [
        // Pending & In Progress → always visible
        { status: { in: ["PENDING", "IN_PROGRESS"] } },

        // Closed → today only
        {
          status: "CLOSED",
          closedAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },

        // Converted → today only
        {
          status: "CONVERTED",
          updatedAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
      ],
    };

    if (source) where.source = source;

    if (search) {
      where.AND = [
        {
          OR: [
            { customerName: { contains: search, mode: "insensitive" } },
            { mobileNumber: { contains: search } },
            { productTitle: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    /** Sorting */
    const allowedSortFields = new Set([
      "createdAt",
      "updatedAt",
      "closedAt",
      "customerName",
      "status",
    ]);

    const sortField = allowedSortFields.has(sortBy) ? sortBy : "updatedAt";
    const orderBy: any = { [sortField]: sortOrder === "asc" ? "asc" : "desc" };

    const [total, leads] = await prisma.$transaction([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  contactPhone: true,
                },
              },
              team: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "My DSU leads fetched", {
      data: leads,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: pageNumber * pageSize < total,
        hasPrev: pageNumber > 1,
      },
    });
  } catch (err: any) {
    console.error("List my DSU leads error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch DSU leads",
    );
  }
}

/**
 * POST /user/leads/:id/helpers
 * Add helper/export employee to lead
 */
export async function addLeadHelper(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session");

    const { id: leadId } = req.params;
    const { accountId, role = "EXPORT", remark } = req.body;

    if (!leadId || !accountId) {
      return sendErrorResponse(res, 400, "Invalid parameters");
    }

    // ensure lead exists
    const leadExists = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        customerName: true,
        productTitle: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!leadExists) {
      return sendErrorResponse(res, 404, "Lead not found");
    }

    const helper = await prisma.leadHelper.upsert({
      where: {
        leadId_accountId: {
          leadId,
          accountId,
        },
      },
      update: {
        isActive: true,
        removedAt: null,
        role,
        remark: remark ?? null,
      },
      create: {
        leadId,
        accountId,
        role,
        remark: remark ?? null,
        addedBy: performerAccountId,
      },
    });

    const helperSnapshot = await resolveAssigneeSnapshot({ accountId });

    await prisma.leadActivityLog.create({
      data: {
        leadId,
        action: "HELPER_ADDED",
        performedBy: performerAccountId,
        meta: {
          initialAssignment: helperSnapshot,
          role,
          remark: remark ?? null,
        },
      },
    });

    let recipientAccountIds: string[] = [accountId];

    if (leadExists.assignments[0]?.accountId) {
      recipientAccountIds.push(leadExists.assignments[0].accountId);
    } else if (leadExists.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: {
          teamId: leadExists.assignments[0].teamId,
          isActive: true,
        },
        select: { accountId: true },
      });
      recipientAccountIds.push(...members.map((m) => m.accountId));
    }

    recipientAccountIds = [...new Set(recipientAccountIds)];

    try {
      const io = getIo();

      const patchPayload = {
        id: leadId,
        patch: {
          helperAdded: {
            accountId,
            role,
            addedAt: new Date(),
          },
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    void triggerHelperNotification({
      leadId,
      helperAccountId: accountId,
      performerAccountId,
      role,
    });

    return sendSuccessResponse(res, 200, "Helper added to Lead", helper);
  } catch (err: any) {
    console.error("addLeadHelper error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to add helper");
  }
}

/**
 * DELETE /user/leads/:id/helpers/:accountId"
 * Remove helper/export employee from lead
 */
export async function removeLeadHelper(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session");

    const { id: leadId, accountId } = req.params;

    // 🔐 ACCESS CHECK (admin OR assignee)
    if (!req.user?.roles?.includes("ADMIN")) {
      try {
        await assertLeadAccessForUser(leadId, performerAccountId);
      } catch {
        return sendErrorResponse(res, 403, "Access denied");
      }
    }

    const existingLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });

    if (!existingLead) return sendErrorResponse(res, 404, "Lead not found");
    const helper = await prisma.leadHelper.findFirst({
      where: {
        leadId,
        accountId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!helper)
      return sendErrorResponse(res, 404, "Helper not found or already removed");

    const updated = await prisma.leadHelper.updateMany({
      where: {
        leadId,
        accountId,
        isActive: true,
      },
      data: {
        isActive: false,
        removedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return sendErrorResponse(res, 404, "Helper not found or already removed");
    }

    const helperSnapshot = await resolveAssigneeSnapshot({ accountId });

    await prisma.leadActivityLog.create({
      data: {
        leadId,
        action: "HELPER_REMOVED",
        performedBy: performerAccountId,
        meta: {
          initialAssignment: helperSnapshot,
        },
      },
    });

    let recipientAccountIds: string[] = [accountId];

    if (existingLead.assignments[0]?.accountId) {
      recipientAccountIds.push(existingLead.assignments[0].accountId);
    } else if (existingLead.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: {
          teamId: existingLead.assignments[0].teamId,
          isActive: true,
        },
        select: { accountId: true },
      });

      recipientAccountIds.push(...members.map((m) => m.accountId));
    }

    recipientAccountIds = [...new Set(recipientAccountIds)];

    try {
      const io = getIo();

      const patchPayload = {
        id: leadId,
        patch: {
          helperRemoved: {
            accountId,
            removedAt: new Date(),
          },
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Helper removed", {
      leadId, accountId
    });
  } catch (err: any) {
    console.error("removeLeadHelper error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to remove helper",
    );
  }
}

export async function startLeadWork(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

    const { id: leadId } = req.params;

    if (!leadId) return sendErrorResponse(res, 400, "Lead ID required");

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { activeLeadId: true },
    });

    if (account?.activeLeadId) {
      return sendErrorResponse(res, 409, "Already working on another lead");
    }

    const initialAssignee = await resolveAssigneeSnapshot({
      accountId: accountId,
    });

    // await prisma.$transaction([
    await Promise.all([
      prisma.account.update({
        where: { id: accountId },
        data: {
          isBusy: true,
          activeLeadId: leadId,
        },
      }),

      prisma.lead.update({
        where: { id: leadId },
        data: { status: "IN_PROGRESS", isWorking: true },
      }),

      prisma.leadActivityLog.create({
        data: {
          leadId,
          action: "WORK_STARTED",
          performedBy: accountId,
          meta: {
            initialAssignment: initialAssignee,
            startedAt: new Date().toISOString(),
          },
        },
      }),

      prisma.busyActivityLog.create({
        data: {
          accountId: accountId,
          fromBusy: false,
          toBusy: true,
          reason: "WORK_STARTED",
        },
      }),
    ]);

    try {
      const io = getIo();

      io.to(`leads:user:${accountId}`).emit("lead:patch", {
        id: leadId,
        patch: {
          status: "IN_PROGRESS",
          isWorking: true,
        },
      });
      io.to(`lead:${leadId}`).emit("lead:patch", {
        id: leadId,
        patch: {
          status: "IN_PROGRESS",
          isWorking: true,
        },
      });
      io.to("leads:admin").emit("lead:patch", {
        id: leadId,
        patch: {
          status: "IN_PROGRESS",
          isWorking: true,
        },
      });

      io.emit("busy:changed", {
        accountId,
        leadId,
        isBusy: true,
      });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Work started", { leadId });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function stopLeadWork(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

    // fetch account with activeLeadId (we need activeLeadId before we clear it)
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { activeLeadId: true },
    });

    const leadId = account?.activeLeadId;
    if (!leadId) {
      return sendErrorResponse(res, 404, "No active work");
    }

    // Find the most recent WORK_STARTED entry for this lead by this account
    const lastStart = await prisma.leadActivityLog.findFirst({
      where: {
        leadId,
        performedBy: accountId,
        action: "WORK_STARTED",
      },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    const now = new Date();
    let durationSeconds = 0;
    let startedAtIso: string | null = null;

    if (lastStart?.meta && typeof lastStart.meta === "object") {
      // prefer meta.startedAt if present, else fallback to createdAt
      startedAtIso =
        (lastStart.meta as any).startedAt ?? lastStart.createdAt.toISOString();
      if (startedAtIso) {
        const startedAtDate = new Date(startedAtIso);
        if (!isNaN(startedAtDate.getTime())) {
          durationSeconds = Math.max(
            0,
            Math.floor((now.getTime() - startedAtDate.getTime()) / 1000),
          );
        }
      }
    } else {
      // fallback: use createdAt from lastStart if present
      if (lastStart?.createdAt) {
        const startedAtDate = lastStart.createdAt;
        durationSeconds = Math.max(
          0,
          Math.floor((now.getTime() - startedAtDate.getTime()) / 1000),
        );
        startedAtIso = startedAtDate.toISOString();
      }
    }

    // Prepare meta for WORK_ENDED
    const endedAtIso = now.toISOString();
    const workEndMeta = {
      initialAssignment: await resolveAssigneeSnapshot({ accountId }),
      startedAt: startedAtIso,
      endedAt: endedAtIso,
      durationSeconds,
    };

    // Transaction:
    // - clear account.activeLeadId, set isBusy false
    // - create WORK_ENDED log with duration
    // - increment lead.totalWorkSeconds by durationSeconds
    // - create busyActivityLog event
    const [updatedAccount, workLog, updatedLead] = await Promise.all([
      prisma.account.update({
        where: { id: accountId },
        data: {
          isBusy: false,
          activeLeadId: null,
        },
      }),

      prisma.leadActivityLog.create({
        data: {
          leadId,
          action: "WORK_ENDED",
          performedBy: accountId,
          meta: workEndMeta,
        },
      }),

      prisma.lead.update({
        where: { id: leadId },
        data: {
          totalWorkSeconds: { increment: durationSeconds },
          isWorking: false,
        },
        select: { id: true, totalWorkSeconds: true },
      }),

      // create busyActivityLog (optional, can be part of separate array entry above)
    ]);

    // create busyActivityLog outside the above array (or include it in the transaction if preferred)
    await prisma.busyActivityLog.create({
      data: {
        accountId: accountId,
        fromBusy: true,
        toBusy: false,
        reason: "WORK_ENDED",
      },
    });

    try {
      const io = getIo();

      io.to(`leads:user:${accountId}`).emit("lead:patch", {
        id: leadId,
        patch: {
          isWorking: false,
        },
      });

      io.emit("busy:changed", {
        accountId,
        leadId: leadId,
        isBusy: false,
      });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Work stopped", {
      leadId,
      durationSeconds,
      totalWorkSeconds: (updatedLead as any)?.totalWorkSeconds ?? null,
      endedAt: endedAtIso,
    });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

/**
 * GET /user/leads/work/current
 */
export async function getMyActiveWork(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    /* 1️⃣ Fetch Account (light select) */
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        activeLeadId: true,
      },
    });

    if (!account?.activeLeadId) {
      return sendSuccessResponse(res, 200, "No active work", null);
    }

    const leadId = account.activeLeadId;

    /* 2️⃣ Fetch Lead + Last Start */
    const [lead, lastStart] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          customerName: true,
          status: true,
          productTitle: true,
          isWorking: true,
          totalWorkSeconds: true,
        },
      }),

      prisma.leadActivityLog.findFirst({
        where: {
          leadId,
          performedBy: accountId,
          action: "WORK_STARTED",
        },
        orderBy: { createdAt: "desc" },
        select: {
          createdAt: true,
          meta: true,
        },
      }),
    ]);

    if (!lead) {
      // Lead deleted or inconsistent state
      return sendSuccessResponse(res, 200, "No active work", null);
    }

    /* 3️⃣ Calculate Live Duration */
    let durationSeconds = 0;
    let startedAt: string | null = null;

    if (lastStart) {
      const startIso =
        (lastStart.meta as any)?.startedAt ?? lastStart.createdAt.toISOString();

      const startDate = new Date(startIso);
      if (!isNaN(startDate.getTime())) {
        durationSeconds = Math.max(
          0,
          Math.floor((Date.now() - startDate.getTime()) / 1000),
        );
        startedAt = startDate.toISOString();
      }
    }

    return sendSuccessResponse(res, 200, "Active work", {
      leadId: lead.id,
      customerName: lead.customerName,
      productTitle: lead.productTitle,
      status: lead.status,
      isWorking: lead.isWorking,
      totalWorkSeconds: lead.totalWorkSeconds,
      currentSessionSeconds: durationSeconds,
      startedAt,
    });
  } catch (err: any) {
    console.error("getMyActiveWork error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch active work",
    );
  }
}

/**
 * GET /user/leads/my/stats/status
 * Lead counts by status for current user
 */
export async function getMyLeadStatusStats(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const { fromDate, toDate, source, demoFromDate, demoToDate, demoStatus, isImportant } =
      req.query as {
        fromDate?: string;
        toDate?: string;
        source?: string;
        demoFromDate?: string;
        demoToDate?: string;
        demoStatus?: string;
        isImportant?: boolean | string;
      };

    const now = new Date();
    const baseWhere = {
      assignments: {
        some: {
          isActive: true,
          OR: [{ accountId }, { team: { members: { some: { accountId } } } }],
        },
      },
      // leadHelpers: {
      //   some: {
      //     isActive: true,
      //     accountId,
      //   },
      // },

      ...(source && { source: source as any }),

      ...(isImportant === "true" && { isImportant: true }),

      ...(fromDate || toDate
        ? {
          createdAt: {
            ...(fromDate && {
              gte: new Date(`${fromDate}T00:00:00.000+05:30`),
            }),
            ...(toDate && { lte: new Date(`${toDate}T23:59:59.999+05:30`) }),
          },
        }
        : {}),

      ...(demoFromDate || demoToDate
        ? {
          demoScheduledAt: {
            ...(demoFromDate && {
              gte: new Date(`${demoFromDate}T00:00:00.000+05:30`),
            }),
            ...(demoToDate && {
              lte: new Date(`${demoToDate}T23:59:59.999+05:30`),
            }),
          },
        }
        : {}),

      ...(demoStatus === "overdue" && {
        demoScheduledAt: { lt: now },
        demoDoneAt: null,
      }),
      ...(demoStatus === "upcoming" && {
        demoScheduledAt: { gt: now },
        demoDoneAt: null,
      }),
      ...(demoStatus === "done" && { demoDoneAt: { not: null } }),
    };

    const statuses = [
      "PENDING",
      "IN_PROGRESS",
      "FOLLOW_UPS",
      "DEMO_DONE",
      "INTERESTED",
      "CONVERTED",
      "CLOSED",
    ] as const;

    // console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nfromDate", fromDate);
    // console.log("\ntoDate", toDate);

    const counts = await prisma.$transaction(
      statuses.map((status) =>
        prisma.lead.count({ where: { ...baseWhere, status } }),
      ),
    );

    const data: Record<string, number> = {};
    let total = 0;

    statuses.forEach((status, i) => {
      data[status] = counts[i];
      total += counts[i];
    });

    data.TOTAL = total;

    return sendSuccessResponse(res, 200, "My lead counts fetched", data);
  } catch (err: any) {
    console.error("My lead stats error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead stats",
    );
  }
}

/**
 * GET /user/leads/stats/value
 * Lead value stats for the logged-in employee — only their assigned leads
 */
export async function getLeadValueStatsUser(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { fromDate, toDate, source } = req.query as Record<string, string>;

    /* ── Base where — always scoped to this user's assignments ── */
    const where: any = {
      assignments: {
        some: {
          accountId: performerAccountId,
          isActive: true,
        },
      },
    };

    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setDate(end.getDate() + 1);
        where.createdAt.lt = end;
      }
    }

    const grouped = await prisma.lead.groupBy({
      by: ["status"],
      where,
      _sum: { cost: true },
      _count: { _all: true },
    });

    const statuses = [
      "PENDING",
      "IN_PROGRESS",
      "FOLLOW_UPS",
      "DEMO_DONE",
      "INTERESTED",
      "CONVERTED",
      "CLOSED",
    ] as const;

    const byStatus = statuses.reduce(
      (acc, status) => {
        const row = grouped.find((r) => r.status === status);
        acc[status] = {
          totalValue: row?._sum?.cost ? Number(row._sum.cost) : 0,
          count: row?._count?._all ?? 0,
        };
        return acc;
      },
      {} as Record<string, { totalValue: number; count: number }>,
    );

    const grandTotalValue = grouped.reduce(
      (sum, row) => sum + (row._sum?.cost ? Number(row._sum.cost) : 0),
      0,
    );

    const grandTotalCount = grouped.reduce(
      (sum, row) => sum + (row._count?._all ?? 0),
      0,
    );

    return sendSuccessResponse(res, 200, "Lead value stats fetched", {
      byStatus,
      total: {
        totalValue: grandTotalValue,
        count: grandTotalCount,
      },
    });
  } catch (err: any) {
    console.error("User lead value stats error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead value stats",
    );
  }
}

/* ─────────────────────────────────────────
    FOLLOW UPS
───────────────────────────────────────── */

/**
 * Recalculates and syncs Lead.nextFollowUpAt + Lead.lastFollowUpDoneAt
 * Must be called inside a transaction after any follow-up mutation.
 */
async function syncLeadFollowUpAggregates(
  tx: any,
  leadId: string,
): Promise<void> {
  const [nextPending, lastDone] = await Promise.all([
    tx.leadFollowUp.findFirst({
      where: { leadId, status: "PENDING" },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true },
    }),
    tx.leadFollowUp.findFirst({
      where: { leadId, status: "DONE" },
      orderBy: { doneAt: "desc" },
      select: { doneAt: true },
    }),
  ]);

  await tx.lead.update({
    where: { id: leadId },
    data: {
      nextFollowUpAt: nextPending?.scheduledAt ?? null,
      lastFollowUpDoneAt: lastDone?.doneAt ?? null,
    },
  });
}

/* ─────────────────────────────────────────
   POST /leads/:leadId/follow-ups
   Create a new follow-up for a lead
───────────────────────────────────────── */
export async function createFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId } = req.params;
    const {
      type = "CALL",
      scheduledAt,
      remark,
    } = req.body as {
      type?: "CALL" | "DEMO" | "MEETING" | "VISIT" | "WHATSAPP" | "OTHER";
      scheduledAt: string;
      remark?: string;
    };

    if (!scheduledAt)
      return sendErrorResponse(res, 400, "scheduledAt is required");

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, customerName: true, status: true },
    });
    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    const followUp = await prisma.$transaction(async (tx) => {
      const created = await tx.leadFollowUp.create({
        data: {
          leadId,
          type,
          status: "PENDING",
          scheduledAt: new Date(scheduledAt),
          remark: remark ?? null,
          createdBy: accountId,
        },
      });

      // increment followUpCount + sync nextFollowUpAt
      await tx.lead.update({
        where: { id: leadId },
        data: { followUpCount: { increment: 1 } },
      });

      await syncLeadFollowUpAggregates(tx, leadId);

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "FOLLOW_UP_SCHEDULED",
          performedBy: accountId,
          meta: {
            followUpId: created.id,
            type,
            scheduledAt: new Date(scheduledAt).toISOString(),
            remark: remark ?? null,
          },
        },
      });

      return created;
    });

    // socket
    try {
      getIo().to("leads:admin").emit("followup:created", { leadId, followUp });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Follow-up scheduled", followUp);
  } catch (err: any) {
    console.error("Create follow-up error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create follow-up",
    );
  }
}

/* ─────────────────────────────────────────
   PATCH /leads/:leadId/follow-ups/:id
   Mark done | reschedule | update remark
───────────────────────────────────────── */
export async function updateFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId, id } = req.params;
    const {
      action, // "done" | "reschedule" | "missed" | "update"
      scheduledAt, // required when action = "reschedule"
      remark,
      type,
    } = req.body as {
      action: "done" | "reschedule" | "missed" | "update";
      scheduledAt?: string;
      remark?: string;
      type?: "CALL" | "DEMO" | "MEETING" | "VISIT" | "WHATSAPP" | "OTHER";
    };

    if (!action)
      return sendErrorResponse(
        res,
        400,
        "action is required: done | reschedule | missed | update",
      );

    const existing = await prisma.leadFollowUp.findFirst({
      where: { id, leadId },
    });
    if (!existing) return sendErrorResponse(res, 404, "Follow-up not found");

    if (existing.status === "DONE")
      return sendErrorResponse(res, 400, "Follow-up already marked as done");

    const result = await prisma.$transaction(async (tx) => {
      let updated: any;
      let newFollowUp: any = null;
      let activityAction: string;

      // ── DONE ──────────────────────────────────────────────────────────
      if (action === "done") {
        updated = await tx.leadFollowUp.update({
          where: { id },
          data: {
            status: "DONE",
            doneAt: new Date(),
            doneBy: accountId,
            remark: remark ?? existing.remark,
          },
        });
        activityAction = "FOLLOW_UP_DONE";
      }

      // ── RESCHEDULE ────────────────────────────────────────────────────
      else if (action === "reschedule") {
        if (!scheduledAt)
          throw new Error("scheduledAt is required for reschedule");

        // mark old one as RESCHEDULED
        updated = await tx.leadFollowUp.update({
          where: { id },
          data: { status: "RESCHEDULED" },
        });

        // create new follow-up linked to old one
        newFollowUp = await tx.leadFollowUp.create({
          data: {
            leadId,
            type: type ?? existing.type,
            status: "PENDING",
            scheduledAt: new Date(scheduledAt),
            remark: remark ?? null,
            rescheduledFrom: { connect: { id } },
            createdBy: accountId,
          },
        });

        await tx.lead.update({
          where: { id: leadId },
          data: { followUpCount: { increment: 1 } },
        });

        activityAction = "FOLLOW_UP_RESCHEDULED";
      }

      // ── MISSED ────────────────────────────────────────────────────────
      else if (action === "missed") {
        updated = await tx.leadFollowUp.update({
          where: { id },
          data: { status: "MISSED" },
        });
        activityAction = "FOLLOW_UP_MISSED";
      }

      // ── UPDATE (remark / type only) ───────────────────────────────────
      else if (action === "update") {
        const patch: any = {};
        if (remark !== undefined) patch.remark = remark;
        if (type !== undefined) patch.type = type;
        if (scheduledAt !== undefined)
          patch.scheduledAt = new Date(scheduledAt);

        updated = await tx.leadFollowUp.update({ where: { id }, data: patch });
        activityAction = "FOLLOW_UP_SCHEDULED"; // reuse — or add FOLLOW_UP_UPDATED enum
      } else {
        throw new Error("Invalid action");
      }

      await syncLeadFollowUpAggregates(tx, leadId);

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: activityAction as any,
          performedBy: accountId,
          meta: {
            action,
            rescheduledTo: newFollowUp?.scheduledAt ?? null,
            remarkTo: newFollowUp?.remark ?? null,
            rescheduledFrom: existing?.scheduledAt ?? null,
            remarkFrom: existing?.remark ?? null,
          },
        },
      });

      return { updated, newFollowUp };
    });

    try {
      getIo()
        .to("leads:admin")
        .emit("followup:updated", { leadId, ...result });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Follow-up updated", result);
  } catch (err: any) {
    console.error("Update follow-up error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update follow-up",
    );
  }
}

/* ─────────────────────────────────────────
   GET /leads/:leadId/follow-ups
   Follow-ups for a specific lead
───────────────────────────────────────── */
export async function getLeadFollowUps(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId } = req.params;
    const { status } = req.query as { status?: string };

    const where: any = { leadId };
    if (status) where.status = status;

    const followUps = await prisma.leadFollowUp.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      include: {
        createdByAcc: {
          select: { id: true, firstName: true, lastName: true },
        },
        doneByAcc: {
          select: { id: true, firstName: true, lastName: true },
        },
        rescheduledTo: {
          select: { id: true, scheduledAt: true, status: true },
        },
        rescheduledFrom: {
          select: { id: true, scheduledAt: true, status: true },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Follow-ups fetched", followUps);
  } catch (err: any) {
    console.error("Get lead follow-ups error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch follow-ups",
    );
  }
}

/* ─────────────────────────────────────────
   GET /follow-ups
   Global list — filter by status / type /
   date range / assignee / overdue etc.
───────────────────────────────────────── */
export async function listFollowUps(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      status, // PENDING | DONE | MISSED | RESCHEDULED
      type, // CALL | DEMO | MEETING | ...
      range, // today | tomorrow | week | overdue | custom
      fromDate,
      toDate,
      assignedToAccountId,
      assignedToTeamId,
      leadId,
      sortBy = "scheduledAt", // scheduledAt | createdAt
      sortOrder = "asc",
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    const now = new Date();

    /* ── where ── */
    const where: any = {};

    if (leadId) where.leadId = leadId;
    if (status) where.status = status;
    if (type) where.type = type;

    // ── date range shortcuts ──────────────────────────────────────────
    if (range === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "tomorrow") {
      const start = new Date(now);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "week") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "overdue") {
      where.status = "PENDING";
      where.scheduledAt = { lt: now };
    } else if (range === "custom") {
      where.scheduledAt = {};
      if (fromDate) where.scheduledAt.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        where.scheduledAt.lte = end;
      }
    }

    // ── filter by lead's assignee ─────────────────────────────────────
    if (assignedToAccountId || assignedToTeamId) {
      where.lead = {
        assignments: {
          some: {
            isActive: true,
            ...(assignedToAccountId ? { accountId: assignedToAccountId } : {}),
            ...(assignedToTeamId ? { teamId: assignedToTeamId } : {}),
          },
        },
      };
    }

    /* ── orderBy ── */
    const validSortFields: Record<string, boolean> = {
      scheduledAt: true,
      createdAt: true,
      doneAt: true,
    };
    const safeSortBy = validSortFields[sortBy] ? sortBy : "scheduledAt";
    const safeOrder = sortOrder === "desc" ? "desc" : "asc";
    const orderBy = [{ [safeSortBy]: safeOrder }];

    /* ── query ── */
    const [total, followUps] = await Promise.all([
      prisma.leadFollowUp.count({ where }),
      prisma.leadFollowUp.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          lead: {
            select: {
              id: true,
              customerName: true,
              mobileNumber: true,
              productTitle: true,
              status: true,
              assignments: {
                where: { isActive: true },
                select: {
                  account: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                  team: { select: { id: true, name: true } },
                },
              },
            },
          },
          createdByAcc: {
            select: { id: true, firstName: true, lastName: true },
          },
          doneByAcc: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Follow-ups fetched", {
      data: followUps,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: pageNumber * pageSize < total,
        hasPrev: pageNumber > 1,
      },
    });
  } catch (err: any) {
    console.error("List follow-ups error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch follow-ups",
    );
  }
}

/* ─────────────────────────────────────────
   DELETE /leads/:leadId/follow-ups/:id
   Only PENDING follow-ups can be deleted
───────────────────────────────────────── */
export async function deleteFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId, id } = req.params;

    const existing = await prisma.leadFollowUp.findFirst({
      where: { id, leadId },
    });
    if (!existing) return sendErrorResponse(res, 404, "Follow-up not found");
    if (existing.status !== "PENDING")
      return sendErrorResponse(
        res,
        400,
        "Only PENDING follow-ups can be deleted",
      );

    await prisma.$transaction(async (tx) => {
      await tx.leadFollowUp.delete({ where: { id } });

      await tx.lead.update({
        where: { id: leadId },
        data: { followUpCount: { decrement: 1 } },
      });

      await syncLeadFollowUpAggregates(tx, leadId);

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "FOLLOW_UP_SCHEDULED", // log deletion in meta
          performedBy: accountId,
          meta: {
            followUpId: id,
            action: "DELETED",
            scheduledAt: existing.scheduledAt,
          },
        },
      });
    });

    return sendSuccessResponse(res, 200, "Follow-up deleted");
  } catch (err: any) {
    console.error("Delete follow-up error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete follow-up",
    );
  }
}
