// src/controller/cloud/cloud.controller.ts
import { Request, Response } from "express";
import { CloudRenewalType, CloudServiceActivityAction, CloudServiceType, Prisma } from "@prisma/client";
import { prisma } from "../../config/database.config";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";

// =============================================================================
// TYPES
// =============================================================================

interface CloudServiceUserInput {
    username?: string;
    password?: string;
    note?: string;
    isAdmin?: boolean;
    tallyNumber?: number; // Comhard only
    isActive?: boolean;
    userCost?: number | null;
    purchaseAt?: string; // ISO date string, optional — if provided, sets the purchase date of this user (for cost calculations)
}

interface CreateCloudServiceBody {
    // -- Customer resolution -----------------------------------------------------
    customerId?: string;    // provide to attach to existing customer
    customerName?: string;  // required when customerId is absent
    customerMobile?: string;

    // -- Common fields -----------------------------------------------------------
    type: CloudServiceType;
    leadId?: string;
    cost?: number;
    renewalType: "QUARTERLY" | "SIX_MONTHS" | "YEARLY";
    purchaseDate?: string;
    billingDate?: string;
    expiryDate?: string;
    isDriveSetup?: boolean;
    isActive?: boolean;
    adminPassword?: string;
    remark?: string;        // optional note logged with CREATED action

    // -- Miracle-specific --------------------------------------------------------
    ipAddress?: string;
    userCount?: number;

    // -- Comhard-specific --------------------------------------------------------
    adminId?: string;
    comhardSubId?: string;
    isOnTrial?: boolean;
    numberOfTally?: number;

    // -- Users (required) --------------------------------------------------------
    users: CloudServiceUserInput[];
}

interface UpdateCloudServiceBody {
    // ── Common updatable fields ─────────────────────────────────────────────────
    leadId?: string | null;
    cost?: number | null;
    renewalType?: "QUARTERLY" | "SIX_MONTHS" | "YEARLY";
    purchaseDate?: string | null;
    billingDate?: string | null;
    expiryDate?: string | null;
    isDriveSetup?: boolean;
    isActive?: boolean;
    adminPassword?: string | null;
    remark?: string; // optional note appended to the UPDATED log
    email?: string; // syncs to Customer.email

    // ── Miracle-specific ────────────────────────────────────────────────────────
    ipAddress?: string | null;
    userCount?: number | null;

    // ── Comhard-specific ────────────────────────────────────────────────────────
    adminId?: string | null;
    comhardSubId?: string | null;
    numberOfTally?: number | null;

    // ── Trial (Comhard only) ────────────────────────────────────────────────────
    // To start a trial:   isOnTrial: true  (only when currently false)
    // To extend a trial:  trialExtendDays: <number>
    // To convert trial:   trialConvert: true  (sets isOnTrial false, trialDoneAt now)
    // To end trial:       trialEnd: true      (sets isOnTrial false, trialDoneAt now)
    isOnTrial?: boolean;
    trialExtendDays?: number;
    trialConvert?: boolean;
    trialEnd?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================


/** Record a diff entry only when old !== new (both defined) */
function diff<T>(
    changes: Record<string, { from: unknown; to: unknown }>,
    key: string,
    from: T | null | undefined,
    to: T | null | undefined,
) {
    // Normalise null / undefined to null for comparison
    const normFrom = from ?? null;
    const normTo = to ?? null;
    if (normFrom !== normTo) {
        changes[key] = { from: normFrom, to: normTo };
    }
}

/** Return full detail shape — reused after every mutation */
async function fetchFullService(id: string) {
    const service = await prisma.cloudService.findUnique({
        where: { id },
        include: {
            customer: {
                select: {
                    id: true,
                    name: true,
                    customerCompanyName: true,
                    mobile: true,
                    email: true,
                    city: true,
                    state: true,
                    tallySerial: true,
                },
            },
            users: true,
            cloudServiceActivityLogs: {
                orderBy: { createdAt: "desc" },
                include: {
                    performedByAcc: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            avatar: true,
                        },
                    },
                },
            },
            lead: {
                select: {
                    id: true,
                    type: true,
                    status: true,
                    productTitle: true,
                    cost: true,
                },
            },
            createdByAcc: {
                select: { id: true, firstName: true, lastName: true },
            },
        },
    });

    return decryptServiceUsers(service);
}
const TRIAL_DAYS = 7;

function buildTrialDates(isOnTrial: boolean): {
    isOnTrial: boolean;
    trialStartDate: Date | null;
    trialEndDate: Date | null;
} {
    if (!isOnTrial) {
        return { isOnTrial: false, trialStartDate: null, trialEndDate: null };
    }
    const trialStartDate = new Date();
    trialStartDate.setHours(0, 0, 0, 0);
    const trialEndDate = new Date(trialStartDate);
    trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);
    return { isOnTrial: true, trialStartDate, trialEndDate };
}

function validateComhardFields(body: CreateCloudServiceBody): string | null {
    if (!body.adminId?.trim()) {
        return "adminId (admin email) is required for Comhard";
    }
    return null;
}

function validateUsers(
    users: CloudServiceUserInput[],
    type: CloudServiceType,
): string | null {
    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        if (type === "COMHARD" && u.tallyNumber !== undefined) {
            if (!Number.isInteger(u.tallyNumber) || u.tallyNumber < 1) {
                return `users[${i}].tallyNumber must be a positive integer`;
            }
        }
        if (type === "MIRACLE" && u.tallyNumber !== undefined) {
            return `users[${i}].tallyNumber is not applicable for Miracle`;
        }
    }
    return null;
}

async function recalculateCloudServiceCost(
    tx: Prisma.TransactionClient,
    cloudServiceId: string,
) {
    const users = await tx.cloudServiceUser.findMany({
        where: {
            cloudServiceId,
            isActive: true,
        },
        select: {
            userCost: true,
        },
    });

    const usersWithCost = users.filter((u) => u.userCost !== null);
    if (usersWithCost.length === 0) {
        return null; // cost is manually managed — do not touch it
    }

    const total = usersWithCost.reduce((sum, user) => {
        return sum + Number(user.userCost ?? 0);
    }, 0);

    await tx.cloudService.update({
        where: {
            id: cloudServiceId,
        },
        data: {
            cost: new Prisma.Decimal(total),
        },
    });

    return total;
}

// -----------------------------------------------------------------------------
// logActivity — thin helper so every caller has the same shape
// Must be called inside a Prisma transaction (tx) so it's atomic with the
// operation it's describing.
// -----------------------------------------------------------------------------
async function logActivity(
    tx: Prisma.TransactionClient,
    cloudServiceId: string,
    action: CloudServiceActivityAction,
    performedBy: string | null,
    options: { meta?: Record<string, any>; remark?: string } = {},
) {
    await tx.cloudServiceActivityLog.create({
        data: {
            cloudServiceId,
            action,
            meta: options.meta ?? {},
            remark: options.remark ?? null,
            performedBy: performedBy ?? null,
        },
    });
}

// =============================================================================
// POST /cloud-services
// =============================================================================

import { encrypt, decrypt } from "../../core/utils/crypto.util";

function safeEncrypt(text: string | null | undefined): string | null {
    if (!text) return null;
    try {
        return encrypt(text);
    } catch {
        return text;
    }
}

function safeDecrypt(text: string | null | undefined): string | null {
    if (!text) return null;
    try {
        return decrypt(text);
    } catch {
        return text; // backwards compat for unencrypted ones
    }
}

function decryptServiceUsers(service: any) {
    if (!service) return service;
    if (service.users && Array.isArray(service.users)) {
        service.users.forEach((u: any) => {
            u.username = safeDecrypt(u.username);
            u.password = safeDecrypt(u.password);
        });
    }
    return service;
}

export async function createCloudService(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const body = req.body as CreateCloudServiceBody;
        const actor = req.user.accountId as string;

        // -- 1. Common required fields --------------------------------------------
        if (!body.type || !["MIRACLE", "COMHARD"].includes(body.type)) {
            return sendErrorResponse(res, 400, "type must be MIRACLE or COMHARD");
        }
        if (!body.renewalType) {
            return sendErrorResponse(res, 400, "renewalType is required");
        }

        // -- 2. Type-specific validation ------------------------------------------
        if (body.type === "COMHARD") {
            const err = validateComhardFields(body);
            if (err) return sendErrorResponse(res, 400, err);
        }

        // -- 3. Users — required --------------------------------------------------
        if (!Array.isArray(body.users) || body.users.length === 0) {
            return sendErrorResponse(
                res,
                400,
                "users array is required and must contain at least one user",
            );
        }
        const usersErr = validateUsers(body.users, body.type);
        if (usersErr) return sendErrorResponse(res, 400, usersErr);

        // -- 4. comhardSubId uniqueness (pre-tx) ----------------------------------
        if (body.comhardSubId?.trim()) {
            const existingSub = await prisma.cloudService.findUnique({
                where: { comhardSubId: body.comhardSubId.trim() },
                select: { id: true },
            });
            if (existingSub) {
                return sendErrorResponse(
                    res,
                    409,
                    `A CloudService with comhardSubId "${body.comhardSubId}" already exists`,
                );
            }
        }

        // -- 5. Customer resolution (pre-tx checks) -------------------------------
        let customerId: string;

        if (body.customerId) {
            const existing = await prisma.customer.findUnique({
                where: { id: body.customerId },
                select: { id: true, isActive: true },
            });
            if (!existing) return sendErrorResponse(res, 404, "Customer not found");
            if (!existing.isActive) {
                return sendErrorResponse(
                    res,
                    400,
                    "Cannot attach cloud service to an inactive customer",
                );
            }
            customerId = existing.id;
        } else {
            if (!body.customerName?.trim()) {
                return sendErrorResponse(
                    res,
                    400,
                    "customerName is required when customerId is not provided",
                );
            }
            if (!body.customerMobile?.trim()) {
                return sendErrorResponse(
                    res,
                    400,
                    "customerMobile is required when customerId is not provided",
                );
            }
            const normalizedMobile = body.customerMobile.replace(/\D/g, "");
            const existingByMobile = await prisma.customer.findUnique({
                where: { normalizedMobile },
                select: { id: true, isActive: true },
            });
            if (existingByMobile) {
                if (!existingByMobile.isActive) {
                    return sendErrorResponse(
                        res,
                        400,
                        "Cannot attach cloud service to an inactive customer found by this mobile number",
                    );
                }
                customerId = existingByMobile.id;
            } else {
                customerId = "__pending__";
            }
        }

        // -- 6. Duplicate active service guard ------------------------------------
        if (customerId !== "__pending__") {
            const duplicate = await prisma.cloudService.findFirst({
                where: { customerId, type: body.type, isActive: true },
                select: { id: true },
            });
            if (duplicate) {
                return sendErrorResponse(
                    res,
                    409,
                    `An active ${body.type} cloud service already exists for this customer`,
                );
            }
        }

        // -- 7. Validate leadId ---------------------------------------------------
        if (body.leadId) {
            const lead = await prisma.lead.findUnique({
                where: { id: body.leadId },
                select: { id: true },
            });
            if (!lead) return sendErrorResponse(res, 404, "Lead not found");
        }

        // -- 8. Trial dates -------------------------------------------------------
        const trialData =
            body.type === "COMHARD" ? buildTrialDates(body.isOnTrial ?? false) : null;

        // -- 9. Transaction -------------------------------------------------------
        const cloudService = await prisma.$transaction(async (tx) => {
            // 9a. Create minimal customer if needed
            if (customerId === "__pending__") {
                const normalizedMobile = body.customerMobile!.replace(/\D/g, "");
                const newCustomer = await tx.customer.create({
                    data: {
                        name: body.customerName!.trim(),
                        mobile: body.customerMobile!.trim(),
                        normalizedMobile,
                        createdBy: actor,
                    },
                });
                customerId = newCustomer.id;
            }

            // 9b. Build service payload
            const purchaseDateObj = body.purchaseDate ? new Date(body.purchaseDate) : null;
            const expiryDateObj =
                body.expiryDate
                    ? new Date(body.expiryDate)                          // explicit override wins
                    : calcExpiryDate(purchaseDateObj, body.renewalType); // auto-calculate

            const serviceData: Prisma.CloudServiceUncheckedCreateInput = {
                customerId,
                leadId: body.leadId ?? null,
                type: body.type,
                cost: body.cost !== undefined ? new Prisma.Decimal(body.cost) : null,
                renewalType: body.renewalType,
                purchaseDate: purchaseDateObj,
                billingDate: body.billingDate ? new Date(body.billingDate) : null,
                expiryDate: expiryDateObj,
                isDriveSetup: body.isDriveSetup ?? false,
                isActive: body.isActive ?? true,
                adminPassword: body.adminPassword ?? null,
                createdBy: actor,

                ...(body.type === "MIRACLE" && {
                    ipAddress: body.ipAddress ?? null,
                    userCount: body.userCount ?? null,
                }),

                ...(body.type === "COMHARD" && {
                    adminId: body.adminId!.trim(),
                    comhardSubId: body.comhardSubId?.trim() ?? null,
                    isOnTrial: trialData!.isOnTrial,
                    trialStartDate: trialData!.trialStartDate,
                    trialEndDate: trialData!.trialEndDate,
                    numberOfTally: body.numberOfTally ?? null,
                }),
            };

            // 9c. Create service
            const created = await tx.cloudService.create({ data: serviceData });

            // 9d. Create users
            await tx.cloudServiceUser.createMany({
                data: body.users.map((u) => ({
                    cloudServiceId: created.id,
                    username: safeEncrypt(u.username) ?? null,
                    password: safeEncrypt(u.password) ?? null,
                    userCost: u.userCost ?? null,
                    purchaseAt: u.purchaseAt ? new Date(u.purchaseAt) : null,
                    note: u.note ?? null,
                    isActive: u.isActive ?? true,
                    ...(body.type === "COMHARD" && {
                        isAdmin: u.isAdmin ?? false,
                        tallyNumber:
                            u.tallyNumber !== undefined &&
                                u.tallyNumber !== null
                                ? String(u.tallyNumber)
                                : null,
                    }),
                })),
            });

            // 9e. Log CREATED
            await logActivity(tx, created.id, "CREATED", actor, {
                meta: {
                    type: body.type,
                    renewalType: body.renewalType,
                    cost: body.cost ?? null,
                    userCount: body.users.length,
                    ...(body.type === "COMHARD" && trialData!.isOnTrial && {
                        trial: {
                            trialStartDate: trialData!.trialStartDate,
                            trialEndDate: trialData!.trialEndDate,
                        },
                    }),
                },
                remark: body.remark,
            });

            // 9f. Log TRIAL_STARTED separately if applicable (Comhard + isOnTrial)
            if (body.type === "COMHARD" && trialData!.isOnTrial) {
                await logActivity(tx, created.id, "TRIAL_STARTED", actor, {
                    meta: {
                        trialStartDate: trialData!.trialStartDate,
                        trialEndDate: trialData!.trialEndDate,
                    },
                });
            }

            // 9g. Return full record
            return tx.cloudService.findUnique({
                where: { id: created.id },
                include: {
                    customer: {
                        select: {
                            id: true,
                            name: true,
                            customerCompanyName: true,
                            mobile: true,
                            email: true,
                            city: true,
                            state: true,
                        },
                    },
                    users: true,
                    cloudServiceActivityLogs: {
                        orderBy: { createdAt: "asc" },
                    },
                    lead: {
                        select: {
                            id: true,
                            type: true,
                            status: true,
                            productTitle: true,
                        },
                    },
                },
            });
        });

        return sendSuccessResponse(
            res,
            201,
            `${body.type} cloud service created successfully`,
            cloudService,
        );
    } catch (err: any) {
        console.error("createCloudService error:", err);
        if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
        ) {
            const target = (err.meta?.target as string[])?.join(", ") ?? "field";
            return sendErrorResponse(res, 409, `Duplicate value on unique field: ${target}`);
        }
        return sendErrorResponse(res, 500, err?.message ?? "Internal server error");
    }
}

function calcExpiryDate(
    purchaseDate: Date | null | undefined,
    renewalType: "QUARTERLY" | "SIX_MONTHS" | "YEARLY",
): Date | null {
    if (!purchaseDate) return null;

    const expiry = new Date(purchaseDate);

    switch (renewalType) {
        case "QUARTERLY":
            expiry.setMonth(expiry.getMonth() + 3);
            break;
        case "SIX_MONTHS":
            expiry.setMonth(expiry.getMonth() + 6);
            break;
        case "YEARLY":
            expiry.setFullYear(expiry.getFullYear() + 1);
            break;
    }

    return expiry;
}

// =============================================================================
// PATCH /cloud-services/:id
// =============================================================================

export async function updateCloudService(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const body = req.body as UpdateCloudServiceBody;
        const actor = req.user.accountId as string;

        // -- 1. Load current service -----------------------------------------------
        const current = await prisma.cloudService.findUnique({
            where: { id },
            select: {
                id: true,
                type: true,
                customerId: true,
                leadId: true,
                cost: true,
                renewalType: true,
                purchaseDate: true,
                billingDate: true,
                expiryDate: true,
                isDriveSetup: true,
                isActive: true,
                adminPassword: true,
                ipAddress: true,
                userCount: true,
                adminId: true,
                comhardSubId: true,
                isOnTrial: true,
                trialStartDate: true,
                trialEndDate: true,
                trialDoneAt: true,
                numberOfTally: true,
                customer: { select: { email: true } },
            },
        });

        if (!current) return sendErrorResponse(res, 404, "Cloud service not found");

        // -- 2. Body is effectively empty ------------------------------------------
        if (Object.keys(body).length === 0) {
            return sendErrorResponse(res, 400, "No fields provided for update");
        }

        // -- 3. Validate comhardSubId uniqueness if it's being changed -------------
        if (
            body.comhardSubId !== undefined &&
            body.comhardSubId !== null &&
            body.comhardSubId.trim() !== (current.comhardSubId ?? "")
        ) {
            const conflict = await prisma.cloudService.findUnique({
                where: { comhardSubId: body.comhardSubId.trim() },
                select: { id: true },
            });
            if (conflict && conflict.id !== id) {
                return sendErrorResponse(
                    res,
                    409,
                    `A CloudService with comhardSubId "${body.comhardSubId}" already exists`,
                );
            }
        }

        // -- 4. Validate leadId if provided ----------------------------------------
        if (body.leadId !== undefined && body.leadId !== null) {
            const lead = await prisma.lead.findUnique({
                where: { id: body.leadId },
                select: { id: true },
            });
            if (!lead) return sendErrorResponse(res, 404, "Lead not found");
        }

        // -- 5. Validate Miracle-only fields ---------------------------------------
        if (current.type === "MIRACLE") {
            if (body.isOnTrial !== undefined || body.trialExtendDays !== undefined ||
                body.trialConvert !== undefined || body.trialEnd !== undefined) {
                return sendErrorResponse(res, 400, "Trial fields are only valid for COMHARD services");
            }
            if (body.adminId !== undefined || body.comhardSubId !== undefined ||
                body.numberOfTally !== undefined) {
                return sendErrorResponse(res, 400, "Comhard-specific fields are not valid for MIRACLE services");
            }
        }

        // -- 6. Validate Comhard-only fields ---------------------------------------
        if (current.type === "COMHARD") {
            if (body.ipAddress !== undefined || body.userCount !== undefined) {
                return sendErrorResponse(res, 400, "Miracle-specific fields are not valid for COMHARD services");
            }
        }

        // -- 7. Trial-op validation ------------------------------------------------
        if (current.type === "COMHARD") {
            const trialOps = [
                body.isOnTrial === true && !current.isOnTrial,
                !!body.trialExtendDays,
                !!body.trialConvert,
                !!body.trialEnd,
            ].filter(Boolean).length;

            if (trialOps > 1) {
                return sendErrorResponse(res, 400, "Only one trial operation may be performed at a time");
            }
            if (body.isOnTrial === true && current.isOnTrial) {
                return sendErrorResponse(res, 400, "Trial is already active");
            }
            if (body.trialExtendDays !== undefined) {
                if (!current.isOnTrial) {
                    return sendErrorResponse(res, 400, "Cannot extend trial — service is not on trial");
                }
                if (!Number.isInteger(body.trialExtendDays) || body.trialExtendDays < 1) {
                    return sendErrorResponse(res, 400, "trialExtendDays must be a positive integer");
                }
            }
            if (body.trialConvert && !current.isOnTrial) {
                return sendErrorResponse(res, 400, "Cannot convert trial — service is not on trial");
            }
            if (body.trialEnd && !current.isOnTrial) {
                return sendErrorResponse(res, 400, "Cannot end trial — service is not on trial");
            }
        }

        // -- 8. Build update data + detect activity actions -----------------------
        const updateData: Prisma.CloudServiceUpdateInput = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const extraActions: {
            action: CloudServiceActivityAction;
            meta: Record<string, any>;
        }[] = [];

        // ── leadId ────────────────────────────────────────────────────────────────
        if (body.leadId !== undefined) {
            diff(changes, "leadId", current.leadId, body.leadId);
            updateData.lead = body.leadId
                ? { connect: { id: body.leadId } }
                : { disconnect: true };
        }

        // ── cost ─────────────────────────────────────────────────────────────────
        if (body.cost !== undefined) {
            const newCost = body.cost !== null ? new Prisma.Decimal(body.cost) : null;
            const currentCostNum = current.cost ? Number(current.cost) : null;
            diff(changes, "cost", currentCostNum, body.cost);
            updateData.cost = newCost;
        }

        // ── renewalType ───────────────────────────────────────────────────────────
        if (body.renewalType !== undefined && body.renewalType !== current.renewalType) {
            diff(changes, "renewalType", current.renewalType, body.renewalType);
            updateData.renewalType = body.renewalType as CloudRenewalType;
            // Emit a targeted RENEWAL_TYPE_CHANGED log as well
            extraActions.push({
                action: "RENEWAL_TYPE_CHANGED",
                meta: { from: current.renewalType, to: body.renewalType },
            });
        }

        // ── purchaseDate ──────────────────────────────────────────────────────────
        if (body.purchaseDate !== undefined) {
            const newDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
            diff(changes, "purchaseDate",
                current.purchaseDate?.toISOString() ?? null,
                newDate?.toISOString() ?? null,
            );
            updateData.purchaseDate = newDate;
        }

        // ── billingDate ───────────────────────────────────────────────────────────
        if (body.billingDate !== undefined) {
            const newDate = body.billingDate ? new Date(body.billingDate) : null;
            diff(changes, "billingDate",
                current.billingDate?.toISOString() ?? null,
                newDate?.toISOString() ?? null,
            );
            updateData.billingDate = newDate;
        }

        // ── expiryDate ────────────────────────────────────────────────────────────────
        // Priority: explicit body.expiryDate > auto-recalc when purchaseDate/renewalType changed > unchanged
        if (body.expiryDate !== undefined) {
            // Caller sent an explicit override (including null to clear it)
            const newDate = body.expiryDate ? new Date(body.expiryDate) : null;
            diff(changes, "expiryDate",
                current.expiryDate?.toISOString() ?? null,
                newDate?.toISOString() ?? null,
            );
            updateData.expiryDate = newDate;
        } else if (body.purchaseDate !== undefined || body.renewalType !== undefined) {
            // purchaseDate or renewalType changed — auto-recalculate
            const resolvedPurchaseDate =
                body.purchaseDate !== undefined
                    ? (body.purchaseDate ? new Date(body.purchaseDate) : null)
                    : (current.purchaseDate ?? null);
            const resolvedRenewalType = (body.renewalType ?? current.renewalType) as CloudRenewalType;
            const autoExpiry = calcExpiryDate(resolvedPurchaseDate, resolvedRenewalType);
            const prevExpiry = current.expiryDate?.toISOString() ?? null;
            const nextExpiry = autoExpiry?.toISOString() ?? null;
            if (prevExpiry !== nextExpiry) {
                diff(changes, "expiryDate", prevExpiry, nextExpiry);
                updateData.expiryDate = autoExpiry;
            }
        }

        // ── isDriveSetup ──────────────────────────────────────────────────────────
        if (body.isDriveSetup !== undefined && body.isDriveSetup !== current.isDriveSetup) {
            diff(changes, "isDriveSetup", current.isDriveSetup, body.isDriveSetup);
            updateData.isDriveSetup = body.isDriveSetup;
            extraActions.push({
                action: body.isDriveSetup ? "DRIVE_SETUP_ENABLED" : "DRIVE_SETUP_DISABLED",
                meta: {},
            });
        }

        // ── isActive ──────────────────────────────────────────────────────────────
        if (body.isActive !== undefined && body.isActive !== current.isActive) {
            diff(changes, "isActive", current.isActive, body.isActive);
            updateData.isActive = body.isActive;
            extraActions.push({
                action: body.isActive ? "REACTIVATED" : "DEACTIVATED",
                meta: {},
            });
        }

        // ── adminPassword ─────────────────────────────────────────────────────────
        if (body.adminPassword !== undefined) {
            // Don't include old password value in diff for security
            if ((body.adminPassword ?? null) !== (current.adminPassword ?? null)) {
                changes["adminPassword"] = { from: "***", to: body.adminPassword ? "***" : null };
            }
            updateData.adminPassword = body.adminPassword ?? null;
        }

        // ── MIRACLE: ipAddress, userCount ─────────────────────────────────────────
        if (current.type === "MIRACLE") {
            if (body.ipAddress !== undefined) {
                diff(changes, "ipAddress", current.ipAddress, body.ipAddress);
                updateData.ipAddress = body.ipAddress ?? null;
            }
            if (body.userCount !== undefined) {
                diff(changes, "userCount", current.userCount, body.userCount);
                updateData.userCount = body.userCount ?? null;
            }
        }

        // ── COMHARD: adminId, comhardSubId, numberOfTally ─────────────────────────
        if (current.type === "COMHARD") {
            if (body.adminId !== undefined) {
                diff(changes, "adminId", current.adminId, body.adminId);
                updateData.adminId = body.adminId ?? null;
            }
            if (body.comhardSubId !== undefined) {
                diff(changes, "comhardSubId", current.comhardSubId, body.comhardSubId);
                updateData.comhardSubId = body.comhardSubId?.trim() ?? null;
            }
            if (body.numberOfTally !== undefined) {
                diff(changes, "numberOfTally", current.numberOfTally, body.numberOfTally);
                updateData.numberOfTally = body.numberOfTally ?? null;
            }

            // ── Trial: START ────────────────────────────────────────────────────────
            if (body.isOnTrial === true && !current.isOnTrial) {
                const trialStartDate = new Date();
                trialStartDate.setHours(0, 0, 0, 0);
                const trialEndDate = new Date(trialStartDate);
                trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);

                updateData.isOnTrial = true;
                updateData.trialStartDate = trialStartDate;
                updateData.trialEndDate = trialEndDate;
                updateData.trialDoneAt = null;

                extraActions.push({
                    action: "TRIAL_STARTED",
                    meta: {
                        trialStartDate: trialStartDate.toISOString(),
                        trialEndDate: trialEndDate.toISOString(),
                    },
                });
            }

            // ── Trial: EXTEND ───────────────────────────────────────────────────────
            if (body.trialExtendDays && body.trialExtendDays > 0) {
                const previousEndDate = current.trialEndDate ?? new Date();
                const newEndDate = new Date(previousEndDate);
                newEndDate.setDate(newEndDate.getDate() + body.trialExtendDays);

                updateData.trialEndDate = newEndDate;

                extraActions.push({
                    action: "TRIAL_EXTENDED",
                    meta: {
                        previousEndDate: previousEndDate.toISOString(),
                        newEndDate: newEndDate.toISOString(),
                        extendedByDays: body.trialExtendDays,
                    },
                });
            }

            // ── Trial: CONVERT ──────────────────────────────────────────────────────
            if (body.trialConvert) {
                updateData.isOnTrial = false;
                updateData.trialDoneAt = new Date();

                extraActions.push({
                    action: "TRIAL_CONVERTED",
                    meta: {
                        comhardSubId: body.comhardSubId?.trim() ?? current.comhardSubId ?? null,
                        convertedAt: new Date().toISOString(),
                    },
                });
            }

            // ── Trial: END ──────────────────────────────────────────────────────────
            if (body.trialEnd) {
                updateData.isOnTrial = false;
                updateData.trialDoneAt = new Date();

                extraActions.push({
                    action: "TRIAL_ENDED",
                    meta: { endedAt: new Date().toISOString() },
                });
            }
        }

        // -- 8.5 Handle Customer Email Sync -----------------------------------------
        if (body.email !== undefined && body.email !== current.customer.email) {
            diff(changes, "customerEmail", current.customer.email, body.email);
        }

        // -- 9. Guard: nothing actually changed ------------------------------------
        const hasFieldChanges = Object.keys(changes).length > 0;
        const hasTrialOp = extraActions.some((a) =>
            ["TRIAL_STARTED", "TRIAL_EXTENDED", "TRIAL_CONVERTED", "TRIAL_ENDED"].includes(a.action),
        );

        if (!hasFieldChanges && !hasTrialOp) {
            return sendErrorResponse(res, 400, "No changes detected — all provided values match current state");
        }

        // -- 10. Transaction -------------------------------------------------------
        await prisma.$transaction(async (tx) => {
            // 10a. Apply field updates
            await tx.cloudService.update({ where: { id }, data: updateData });

            // 10a2. Sync Customer email if provided
            if (body.email !== undefined && body.email !== current.customer.email) {
                await tx.customer.update({
                    where: { id: current.customerId },
                    data: { email: body.email || null },
                });
            }

            // 10b. Log primary UPDATED (only if non-trivial field changes exist)
            //      We skip it when the only logged things are isActive / isDriveSetup /
            //      trial ops because those each get their own targeted log below.
            const dedicatedActionKeys = new Set(["isActive", "isDriveSetup"]);
            const generalChanges = Object.fromEntries(
                Object.entries(changes).filter(([k]) => !dedicatedActionKeys.has(k)),
            );

            if (Object.keys(generalChanges).length > 0) {
                await tx.cloudServiceActivityLog.create({
                    data: {
                        cloudServiceId: id,
                        action: "UPDATED",
                        meta: {
                            changes: generalChanges,
                        } as Prisma.InputJsonValue,
                        remark: body.remark ?? null,
                        performedBy: actor,
                    },
                });
            }

            // 10c. Log each extra targeted action
            for (const { action, meta } of extraActions) {
                await tx.cloudServiceActivityLog.create({
                    data: {
                        cloudServiceId: id,
                        action,
                        meta,
                        remark: body.remark ?? null,
                        performedBy: actor,
                    },
                });
            }
        });

        // -- 11. Return full detail ------------------------------------------------
        const updated = await fetchFullService(id);
        if (!updated) return sendErrorResponse(res, 500, "Failed to reload updated service");

        return sendSuccessResponse(res, 200, "Cloud service updated successfully", updated);
    } catch (err: any) {
        console.error("updateCloudService error:", err);
        if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
        ) {
            const target = (err.meta?.target as string[])?.join(", ") ?? "field";
            return sendErrorResponse(res, 409, `Duplicate value on unique field: ${target}`);
        }
        return sendErrorResponse(res, 500, err?.message ?? "Internal server error");
    }
}

// =============================================================================
// GET /cloud-services
// =============================================================================

export async function getCloudServiceList(req: Request, res: Response) {
    try {
        if (!req.user?.id) {
            return sendErrorResponse(res, 401, "Unauthorized");
        }

        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const {
            type,
            isActive,
            customerId,
            isOnTrial,
            renewalType,

            search,
            hasExpired,
            expiringInDays,

            // purchase date
            purchaseDateFrom,
            purchaseDateTo,

            // billing date
            billingDateFrom,
            billingDateTo,

            // expiry date
            expiryDateFrom,
            expiryDateTo,

            // trial start
            trialStartDateFrom,
            trialStartDateTo,

            // trial end
            trialEndDateFrom,
            trialEndDateTo,

            // trial done
            trialDoneAtFrom,
            trialDoneAtTo,

            isDriveSetup,
            trialCompleted,
            neverTrialed,
        } = req.query as Record<string, string>;

        const andConditions: Prisma.CloudServiceWhereInput[] = [];

        // -------------------------------------------------------------------------
        // Search
        // -------------------------------------------------------------------------

        if (search?.trim()) {
            andConditions.push({
                OR: [
                    {
                        customer: {
                            name: {
                                contains: search.trim(),
                                mode: "insensitive",
                            },
                        },
                    },

                    {
                        customer: {
                            customerCompanyName: {
                                contains: search.trim(),
                                mode: "insensitive",
                            },
                        },
                    },

                    {
                        customer: {
                            mobile: {
                                contains: search.trim(),
                                mode: "insensitive",
                            },
                        },
                    },



                    {
                        adminId: {
                            contains: search.trim(),
                            mode: "insensitive",
                        },
                    },

                    {
                        comhardSubId: {
                            contains: search.trim(),
                            mode: "insensitive",
                        },
                    },
                ],
            });
        }

        // -------------------------------------------------------------------------
        // Expired Filter
        // -------------------------------------------------------------------------

        if (hasExpired !== undefined) {
            const now = new Date();

            if (hasExpired === "true") {
                andConditions.push({
                    expiryDate: {
                        lt: now,
                    },
                });
            } else {
                andConditions.push({
                    OR: [
                        {
                            expiryDate: null,
                        },
                        {
                            expiryDate: {
                                gte: now,
                            },
                        },
                    ],
                });
            }
        }

        // -------------------------------------------------------------------------
        // Expiring In Days
        // -------------------------------------------------------------------------

        if (expiringInDays) {
            const days = Number(expiringInDays);

            if (!Number.isNaN(days) && days > 0) {
                const now = new Date();

                const future = new Date();
                future.setDate(future.getDate() + days);

                andConditions.push({
                    expiryDate: {
                        gte: now,
                        lte: future,
                    },
                });
            }
        }

        // ── isDriveSetup ──────────────────────────────────────────────────────────────
        if (isDriveSetup !== undefined) {
            andConditions.push({
                isDriveSetup: isDriveSetup === "true",
            });
        }

        // ── trialCompleted (trialDoneAt is set) ───────────────────────────────────────
        if (trialCompleted !== undefined) {
            if (trialCompleted === "true") {
                andConditions.push({
                    trialDoneAt: { not: null },
                });
            } else {
                andConditions.push({
                    trialDoneAt: null,
                });
            }
        }

        // ── neverTrialed (trialStartDate is null) ─────────────────────────────────────
        if (neverTrialed !== undefined) {
            if (neverTrialed === "true") {
                andConditions.push({
                    trialStartDate: null,
                });
            } else {
                andConditions.push({
                    trialStartDate: { not: null },
                });
            }
        }




        // -------------------------------------------------------------------------
        // Basic filters
        // -------------------------------------------------------------------------

        if (type) {
            andConditions.push({
                type: type as CloudServiceType,
            });
        }

        if (isActive !== undefined) {
            andConditions.push({
                isActive: isActive === "true",
            });
        }

        if (customerId) {
            andConditions.push({
                customerId,
            });
        }

        if (renewalType) {
            andConditions.push({
                renewalType: renewalType as any,
            });
        }

        if (isOnTrial !== undefined) {
            andConditions.push({
                isOnTrial: isOnTrial === "true",
            });
        }

        // -------------------------------------------------------------------------
        // Purchase Date Range
        // -------------------------------------------------------------------------

        if (purchaseDateFrom || purchaseDateTo) {
            andConditions.push({
                purchaseDate: {
                    ...(purchaseDateFrom && {
                        gte: new Date(purchaseDateFrom),
                    }),

                    ...(purchaseDateTo && {
                        lte: new Date(purchaseDateTo),
                    }),
                },
            });
        }

        // -------------------------------------------------------------------------
        // Billing Date Range
        // -------------------------------------------------------------------------

        if (billingDateFrom || billingDateTo) {
            andConditions.push({
                billingDate: {
                    ...(billingDateFrom && {
                        gte: new Date(billingDateFrom),
                    }),

                    ...(billingDateTo && {
                        lte: new Date(billingDateTo),
                    }),
                },
            });
        }

        // -------------------------------------------------------------------------
        // Expiry Date Range
        // -------------------------------------------------------------------------

        if (expiryDateFrom || expiryDateTo) {
            andConditions.push({
                expiryDate: {
                    ...(expiryDateFrom && {
                        gte: new Date(expiryDateFrom),
                    }),

                    ...(expiryDateTo && {
                        lte: new Date(expiryDateTo),
                    }),
                },
            });
        }

        // -------------------------------------------------------------------------
        // Trial Start Date Range
        // -------------------------------------------------------------------------

        if (trialStartDateFrom || trialStartDateTo) {
            andConditions.push({
                trialStartDate: {
                    ...(trialStartDateFrom && {
                        gte: new Date(trialStartDateFrom),
                    }),

                    ...(trialStartDateTo && {
                        lte: new Date(trialStartDateTo),
                    }),
                },
            });
        }

        // -------------------------------------------------------------------------
        // Trial End Date Range
        // -------------------------------------------------------------------------

        if (trialEndDateFrom || trialEndDateTo) {
            andConditions.push({
                trialEndDate: {
                    ...(trialEndDateFrom && {
                        gte: new Date(trialEndDateFrom),
                    }),

                    ...(trialEndDateTo && {
                        lte: new Date(trialEndDateTo),
                    }),
                },
            });
        }

        // -------------------------------------------------------------------------
        // Trial Done At Range
        // -------------------------------------------------------------------------

        if (trialDoneAtFrom || trialDoneAtTo) {
            andConditions.push({
                trialDoneAt: {
                    ...(trialDoneAtFrom && {
                        gte: new Date(trialDoneAtFrom),
                    }),

                    ...(trialDoneAtTo && {
                        lte: new Date(trialDoneAtTo),
                    }),
                },
            });
        }

        // -------------------------------------------------------------------------
        // Final where
        // -------------------------------------------------------------------------

        const where: Prisma.CloudServiceWhereInput =
            andConditions.length > 0
                ? { AND: andConditions }
                : {};

        const [items, total] = await prisma.$transaction([
            prisma.cloudService.findMany({
                where,
                skip,
                take: limit,

                orderBy: [
                    {
                        expiryDate: {
                            sort: "asc",
                            nulls: "last",
                        },
                    },
                    {
                        createdAt: "desc",
                    },
                ],

                include: {
                    customer: {
                        select: {
                            id: true,
                            name: true,
                            customerCompanyName: true,
                            mobile: true,
                        },
                    },

                    users: {
                        where: {
                            isActive: true,
                        },

                        select: {
                            id: true,
                            username: true,
                            isAdmin: true,
                            tallyNumber: true,
                            isActive: true,
                            userCost: true,
                            purchaseAt: true,
                        },
                    },
                },
            }),

            prisma.cloudService.count({
                where,
            }),
        ]);

        return sendSuccessResponse(
            res,
            200,
            "Cloud services fetched",
            {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                items: items.map(decryptServiceUsers),
            },
        );
    } catch (err: any) {
        console.error("getCloudServiceList error:", err);

        return sendErrorResponse(
            res,
            500,
            err?.message ?? "Failed to fetch cloud services",
        );
    }
}

// =============================================================================
// GET /cloud-services/:id
// =============================================================================

export async function getCloudServiceDetails(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const service = await prisma.cloudService.findUnique({
            where: { id },
            include: {
                customer: {
                    select: {
                        id: true,
                        name: true,
                        customerCompanyName: true,
                        mobile: true,
                        email: true,
                        city: true,
                        state: true,
                        tallySerial: true,
                    },
                },
                users: true,
                cloudServiceActivityLogs: {
                    orderBy: { createdAt: "desc" },
                    include: {
                        performedByAcc: {
                            select: { id: true, firstName: true, lastName: true, avatar: true },
                        },
                    },
                },
                lead: {
                    select: {
                        id: true,
                        type: true,
                        status: true,
                        productTitle: true,
                        cost: true,
                    },
                },
                createdByAcc: {
                    select: { id: true, firstName: true, lastName: true },
                },
            },
        });

        if (!service) return sendErrorResponse(res, 404, "Cloud service not found");

        return sendSuccessResponse(res, 200, "Cloud service details fetched", decryptServiceUsers(service));
    } catch (err: any) {
        console.error("getCloudServiceDetails error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch cloud service");
    }
}

// =============================================================================
// GET /cloud-services/:id/activity
// Paginated activity log for a single service
// =============================================================================

export async function getCloudServiceActivity(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const service = await prisma.cloudService.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!service) return sendErrorResponse(res, 404, "Cloud service not found");

        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Number(req.query.limit) || 30, 100);
        const skip = (page - 1) * limit;

        const { action } = req.query as Record<string, string>;

        const where: Prisma.CloudServiceActivityLogWhereInput = {
            cloudServiceId: id,
            ...(action && { action: action as CloudServiceActivityAction }),
        };

        const [logs, total] = await prisma.$transaction([
            prisma.cloudServiceActivityLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    performedByAcc: {
                        select: { id: true, firstName: true, lastName: true, avatar: true },
                    },
                },
            }),
            prisma.cloudServiceActivityLog.count({ where }),
        ]);

        return sendSuccessResponse(res, 200, "Activity log fetched", {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
            logs,
        });
    } catch (err: any) {
        console.error("getCloudServiceActivity error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch activity log");
    }
}

// =============================================================================
// POST /cloud-services/:id/note
// Add a standalone remark without changing any other field
// =============================================================================

export async function addCloudServiceNote(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        const { remark } = req.body as { remark?: string };
        const actor = req.user.accountId as string;

        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");
        if (!remark?.trim()) return sendErrorResponse(res, 400, "remark is required");

        const service = await prisma.cloudService.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!service) return sendErrorResponse(res, 404, "Cloud service not found");

        const log = await prisma.cloudServiceActivityLog.create({
            data: {
                cloudServiceId: id,
                action: "NOTE_ADDED",
                remark: remark.trim(),
                performedBy: actor,
            },
            include: {
                performedByAcc: {
                    select: { id: true, firstName: true, lastName: true },
                },
            },
        });

        return sendSuccessResponse(res, 201, "Note added", log);
    } catch (err: any) {
        console.error("addCloudServiceNote error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to add note");
    }
}

// =============================================================================
// DELETE /cloud-services/:id
// =============================================================================

export async function deleteCloudService(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const service = await prisma.cloudService.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!service) return sendErrorResponse(res, 404, "Cloud service not found");

        await prisma.cloudService.delete({ where: { id } });

        return sendSuccessResponse(res, 200, "Cloud service deleted successfully", { id });
    } catch (err: any) {
        console.error("deleteCloudService error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to delete cloud service");
    }
}

// =============================================================================
// PATCH /cloud-services/:id/renew
// =============================================================================

interface RenewCloudServiceBody {
    renewalType?: "QUARTERLY" | "SIX_MONTHS" | "YEARLY";
    purchaseDate?: string;
    expiryDate?: string;
    cost?: number;
    remark?: string;
}

export async function renewCloudService(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const body = req.body as RenewCloudServiceBody;
        const actor = req.user.accountId as string;

        const current = await prisma.cloudService.findUnique({
            where: { id },
            select: {
                id: true,
                renewalType: true,
                purchaseDate: true,
                expiryDate: true,
                cost: true,
            },
        });
        if (!current) return sendErrorResponse(res, 404, "Cloud service not found");

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const updateData: Prisma.CloudServiceUpdateInput = {};

        // 1. Resolve Renewal Type
        const newRenewalType = (body.renewalType || current.renewalType) as CloudRenewalType;
        updateData.renewalType = newRenewalType;

        // 2. Resolve Purchase Date
        let newPurchaseDate: Date;
        if (body.purchaseDate) {
            newPurchaseDate = new Date(body.purchaseDate);
            newPurchaseDate.setHours(0, 0, 0, 0);
        } else {
            // Auto-calculate base date for renewal
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            if (current.expiryDate && new Date(current.expiryDate) >= now) {
                // If not expired, start from current expiryDate
                newPurchaseDate = new Date(current.expiryDate);
                newPurchaseDate.setHours(0, 0, 0, 0);
            } else {
                // If expired or null, start from today
                newPurchaseDate = now;
            }
        }
        updateData.purchaseDate = newPurchaseDate;

        // 3. Resolve Expiry Date
        let newExpiryDate: Date | null;
        if (body.expiryDate) {
            newExpiryDate = new Date(body.expiryDate);
            newExpiryDate.setHours(0, 0, 0, 0);
        } else {
            newExpiryDate = calcExpiryDate(newPurchaseDate, newRenewalType);
            if (newExpiryDate) {
                newExpiryDate.setHours(0, 0, 0, 0);
            }
        }
        updateData.expiryDate = newExpiryDate;

        // 4. Resolve Cost
        const newCost = body.cost !== undefined
            ? (body.cost !== null ? new Prisma.Decimal(body.cost) : null)
            : current.cost;
        updateData.cost = newCost;

        // 5. Track diff
        diff(changes, "renewalType", current.renewalType, newRenewalType);
        diff(changes, "purchaseDate",
            current.purchaseDate?.toISOString() ?? null,
            newPurchaseDate.toISOString(),
        );
        diff(changes, "expiryDate",
            current.expiryDate?.toISOString() ?? null,
            newExpiryDate?.toISOString() ?? null,
        );
        diff(changes, "cost",
            current.cost ? Number(current.cost) : null,
            newCost ? Number(newCost) : null,
        );

        if (Object.keys(changes).length === 0) {
            return sendErrorResponse(res, 400, "No changes detected — all provided values match current state");
        }

        await prisma.$transaction(async (tx) => {
            await tx.cloudService.update({ where: { id }, data: updateData });
            await logActivity(tx, id, "RENEWED", actor, {
                meta: { changes },
                remark: body.remark || "Renewed service",
            });
        });

        const updated = await fetchFullService(id);
        if (!updated) return sendErrorResponse(res, 500, "Failed to reload renewed service");

        return sendSuccessResponse(res, 200, "Cloud service renewed successfully", updated);
    } catch (err: any) {
        console.error("renewCloudService error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to renew cloud service");
    }
}

// =============================================================================
// POST /cloud-services/:id/cancel-renewal
// =============================================================================

export async function cancelLatestRenewal(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const actor = req.user.accountId as string;

        // 1. Get the latest RENEWED activity log
        const latestRenewal = await prisma.cloudServiceActivityLog.findFirst({
            where: {
                cloudServiceId: id,
                action: "RENEWED",
            },
            orderBy: { createdAt: "desc" },
        });

        if (!latestRenewal) {
            return sendErrorResponse(res, 400, "No renewal history found for this service");
        }

        // 2. Parse the changes from meta
        const meta = latestRenewal.meta as any;
        const changes = meta?.changes;

        if (!changes) {
            return sendErrorResponse(res, 400, "Invalid renewal metadata; cannot cancel");
        }

        // 3. Prepare the reverted values
        const updateData: Prisma.CloudServiceUpdateInput = {};

        if (changes.renewalType) {
            updateData.renewalType = changes.renewalType.from as CloudRenewalType;
        }
        if (changes.purchaseDate) {
            updateData.purchaseDate = changes.purchaseDate.from ? new Date(changes.purchaseDate.from) : null;
        }
        if (changes.expiryDate) {
            updateData.expiryDate = changes.expiryDate.from ? new Date(changes.expiryDate.from) : null;
        }
        if (changes.cost) {
            updateData.cost = changes.cost.from !== null ? new Prisma.Decimal(changes.cost.from) : null;
        }

        // 4. Update the service and delete the log in a transaction
        await prisma.$transaction(async (tx) => {
            await tx.cloudService.update({
                where: { id },
                data: updateData,
            });
            // Delete the renewal activity log
            await tx.cloudServiceActivityLog.delete({
                where: { id: latestRenewal.id },
            });
            // Log a RENEWAL_CANCELLED activity log
            await logActivity(tx, id, "RENEWAL_CANCELLED", actor, {
                remark: "Cancelled latest renewal and reverted service dates/cost",
            });
        });

        const updated = await fetchFullService(id);
        if (!updated) return sendErrorResponse(res, 500, "Failed to reload service");

        return sendSuccessResponse(res, 200, "Latest renewal cancelled successfully", updated);
    } catch (err: any) {
        console.error("cancelLatestRenewal error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to cancel renewal");
    }
}

// =============================================================================
// PATCH /cloud-services/:id/toggle
// =============================================================================

export async function toggleCloudServiceStatus(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const { remark } = req.body as { remark?: string };
        const actor = req.user.accountId as string;

        const current = await prisma.cloudService.findUnique({
            where: { id },
            select: { id: true, isActive: true },
        });
        if (!current) return sendErrorResponse(res, 404, "Cloud service not found");

        const newStatus = !current.isActive;

        await prisma.$transaction(async (tx) => {
            await tx.cloudService.update({
                where: { id },
                data: { isActive: newStatus },
            });
            await logActivity(tx, id, newStatus ? "REACTIVATED" : "DEACTIVATED", actor, {
                meta: { from: current.isActive, to: newStatus },
                remark,
            });
        });

        const updated = await fetchFullService(id);
        if (!updated) return sendErrorResponse(res, 500, "Failed to reload service");

        return sendSuccessResponse(res, 200, "Status updated successfully", updated);
    } catch (err: any) {
        console.error("toggleCloudServiceStatus error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to toggle status");
    }
}

// =============================================================================
// POST /cloud-services/:id/users
// =============================================================================

export async function addCloudServiceUser(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");

        const user = req.body as CloudServiceUserInput;
        const actor = req.user.accountId as string;

        const service = await prisma.cloudService.findUnique({
            where: { id },
            select: { id: true, type: true },
        });
        if (!service) return sendErrorResponse(res, 404, "Cloud service not found");

        const validationErr = validateUsers([user], service.type);
        if (validationErr) return sendErrorResponse(res, 400, validationErr);

        await prisma.$transaction(async (tx) => {
            await tx.cloudServiceUser.create({
                data: {
                    cloudServiceId: id,
                    username: safeEncrypt(user.username) ?? null,
                    password: safeEncrypt(user.password) ?? null,
                    userCost: user.userCost ?? null,
                    purchaseAt: user.purchaseAt ? new Date(user.purchaseAt) : null,
                    note: user.note ?? null,
                    isActive: user.isActive ?? true,
                    ...(service.type === "COMHARD" && {
                        isAdmin: user.isAdmin ?? false,
                        tallyNumber:
                            user.tallyNumber !== undefined &&
                                user.tallyNumber !== null
                                ? String(user.tallyNumber)
                                : null,
                    }),
                },
            });
            const totalCost = await recalculateCloudServiceCost(tx, id);
            await logActivity(tx, id, "USER_ADDED", actor, {
                meta: {
                    users: [{
                        username: user.username ?? null,
                        userCost: user.userCost ?? null,
                        isAdmin: user.isAdmin ?? null,
                        tallyNumber: user.tallyNumber ?? null,
                        purchaseAt: user.purchaseAt ? new Date(user.purchaseAt) : null,
                    }],
                    ...(totalCost !== null && { newTotalCost: totalCost }),
                },
            });
        });

        const updated = await fetchFullService(id);
        if (!updated) return sendErrorResponse(res, 500, "Failed to reload service");

        return sendSuccessResponse(res, 201, "User added successfully", updated);
    } catch (err: any) {
        console.error("addCloudServiceUser error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to add user");
    }
}

// =============================================================================
// PATCH /cloud-services/:id/users/:userId
// =============================================================================

export async function updateCloudServiceUser(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id, userId } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");
        if (!userId) return sendErrorResponse(res, 400, "User id is required");

        const body = req.body as Partial<CloudServiceUserInput>;
        const actor = req.user.accountId as string;

        if (Object.keys(body).length === 0) {
            return sendErrorResponse(res, 400, "No fields provided for update");
        }

        const currentUser = await prisma.cloudServiceUser.findUnique({
            where: { id: userId },
            select: {
                id: true,
                cloudServiceId: true,
                username: true,
                password: true,
                userCost: true,
                purchaseAt: true,
                note: true,
                isAdmin: true,
                tallyNumber: true,
                isActive: true,
            },
        });
        if (!currentUser || currentUser.cloudServiceId !== id) {
            return sendErrorResponse(res, 404, "User not found on this cloud service");
        }

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const updateData: Prisma.CloudServiceUserUpdateInput = {};

        if (body.username !== undefined) {
            diff(changes, "username", safeDecrypt(currentUser.username), body.username);
            updateData.username = safeEncrypt(body.username) ?? null;
        }
        if (body.password !== undefined) {
            if ((body.password ?? null) !== (safeDecrypt(currentUser.password) ?? null)) {
                changes["password"] = { from: "***", to: body.password ? "***" : null };
            }
            updateData.password = safeEncrypt(body.password) ?? null;
        }
        if (body.note !== undefined) {
            diff(changes, "note", currentUser.note, body.note);
            updateData.note = body.note ?? null;
        }
        if (body.isAdmin !== undefined) {
            diff(changes, "isAdmin", currentUser.isAdmin, body.isAdmin);
            updateData.isAdmin = body.isAdmin;
        }
        if (body.tallyNumber !== undefined) {
            const tallyNumber =
                body.tallyNumber !== null && body.tallyNumber !== undefined
                    ? String(body.tallyNumber)
                    : null;

            diff(
                changes,
                "tallyNumber",
                currentUser.tallyNumber,
                tallyNumber,
            );

            updateData.tallyNumber = tallyNumber;
        }
        if (body.userCost !== undefined) {
            const userCost =
                body.userCost !== null &&
                    body.userCost !== undefined
                    ? new Prisma.Decimal(body.userCost)
                    : null;

            diff(
                changes,
                "userCost",
                currentUser.userCost?.toString() ?? null,
                userCost?.toString() ?? null,
            );

            updateData.userCost = userCost;
        }
        if (body.isActive !== undefined) {
            diff(changes, "isActive", currentUser.isActive, body.isActive);
            updateData.isActive = body.isActive;
        }

        if (Object.keys(changes).length === 0) {
            return sendErrorResponse(res, 400, "No changes detected — all provided values match current state");
        }

        await prisma.$transaction(async (tx) => {
            await tx.cloudServiceUser.update({
                where: { id: userId },
                data: updateData,
            });
            const totalCost = await recalculateCloudServiceCost(tx, id);
            await logActivity(tx, id, "USER_UPDATED", actor, {
                meta: { userId, changes, totalCost, ...(totalCost !== null && { newTotalCost: totalCost }), },
            });
        });

        const updated = await fetchFullService(id);
        if (!updated) return sendErrorResponse(res, 500, "Failed to reload service");

        return sendSuccessResponse(res, 200, "User updated successfully", updated);
    } catch (err: any) {
        console.error("updateCloudServiceUser error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to update user");
    }
}

// =============================================================================
// DELETE /cloud-services/:id/users/:userId  — hard delete
// =============================================================================

export async function removeCloudServiceUser(req: Request, res: Response) {
    try {
        if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

        const { id, userId } = req.params;
        if (!id) return sendErrorResponse(res, 400, "Cloud service id is required");
        if (!userId) return sendErrorResponse(res, 400, "User id is required");

        const actor = req.user.accountId as string;

        const user = await prisma.cloudServiceUser.findUnique({
            where: { id: userId },
            select: { id: true, cloudServiceId: true, username: true },
        });
        if (!user || user.cloudServiceId !== id) {
            return sendErrorResponse(res, 404, "User not found on this cloud service");
        }

        await prisma.$transaction(async (tx) => {
            await tx.cloudServiceUser.delete({ where: { id: userId } });
            await logActivity(tx, id, "USER_REMOVED", actor, {
                meta: { userId, username: user.username ?? null },
            });
            await recalculateCloudServiceCost(tx, id);
        });


        const updated = await fetchFullService(id);
        if (!updated) return sendErrorResponse(res, 500, "Failed to reload service");

        return sendSuccessResponse(res, 200, "User removed successfully", updated);
    } catch (err: any) {
        console.error("removeCloudServiceUser error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to remove user");
    }
}