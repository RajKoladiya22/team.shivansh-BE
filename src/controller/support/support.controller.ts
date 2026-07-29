import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
import { SupportStatus, SupportActivityAction } from "@prisma/client";
import { getIo } from "../../core/utils/socket";


async function emitSupportPatch(supportId, patchData) {
    try {
        const io = getIo();
        io.to("supports:admin").emit("support:patch", { id: supportId, patch: patchData });
        
        const support = await prisma.support.findUnique({
            where: { id: supportId },
            select: { createdBy: true, assignments: { select: { accountId: true, isActive: true } } }
        });
        
        if (support) {
            if (support.createdBy) {
                io.to(`supports:user:${support.createdBy}`).emit("support:patch", { id: supportId, patch: patchData });
            }
            for (const a of support.assignments) {
                if (a.isActive && a.accountId && a.accountId !== support.createdBy) {
                    io.to(`supports:user:${a.accountId}`).emit("support:patch", { id: supportId, patch: patchData });
                }
            }
        }
    } catch (e) {
        console.warn("Socket emit skipped", e);
    }
}

export async function createSupportAdmin(req: Request, res: Response) {
    try {
        const {
            subject, description, type, priority, product, expert, remarks, productCatalogId, isWorking,
            mobileNumber, customerName, customerCompanyName, customerCategory, businessCategory, state, city,
            assigneeAccountId, assigneeTeamId,
        } = req.body;
        const createdBy = req.user?.accountId;

        if (!mobileNumber || !customerName) {
            return sendErrorResponse(res, 400, "Mobile number and customer name are required");
        }

        const normalizedMobile = mobileNumber.replace(/\D/g, "").slice(-10);
        let customer = await prisma.customer.findFirst({
            where: { mobile: normalizedMobile },
        });

        if (!customer) {
            customer = await prisma.customer.create({
                data: {
                    name: customerName,
                    mobile: normalizedMobile,
                    normalizedMobile: normalizedMobile,
                    customerCompanyName: customerCompanyName,
                    customerCategory: customerCategory || "OTHER",
                    businessCategory: businessCategory || "OTHER",
                    state,
                    city,
                },
            });
        }

        const support = await prisma.support.create({
            data: {
                subject,
                description,
                type,
                priority,
                customer: { connect: { id: customer.id } },
                product: product || null,
                productCatalogId: productCatalogId || null,
                productCatalog: productCatalogId ? { connect: { id: productCatalogId } } : undefined,
                isWorking: isWorking || false,
                expert: expert || null,
                remarks: remarks || null,
                createdByAcc: createdBy ? { connect: { id: createdBy } } : undefined,
                assignments: (assigneeAccountId || assigneeTeamId) ? {
                    create: {
                        type: assigneeTeamId ? "TEAM" : "ACCOUNT",
                        accountId: assigneeAccountId || undefined,
                        teamId: assigneeTeamId || undefined,
                        assignedBy: createdBy
                    }
                } : undefined,
                activityLogs: {
                    create: {
                        action: "CREATED",
                        performedByAccount: createdBy ? { connect: { id: createdBy } } : undefined,
                    }
                }
            },
            include: { customer: true, assignments: { include: { account: true, team: true } } }
        });

        try {
            const io = getIo();
            io.to("supports:admin").emit("support:created", support);
            if (assigneeAccountId) io.to(`supports:user:${assigneeAccountId}`).emit("support:created", support);
            if (createdBy && createdBy !== assigneeAccountId) io.to(`supports:user:${createdBy}`).emit("support:created", support);
        } catch (e) {
            console.warn("Socket emit skipped", e);
        }

        return sendSuccessResponse(res, 201, "Support created successfully", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error creating support");
    }
}

export async function createSupportUser(req: Request, res: Response) {
    try {
        const {
            subject, description, type, priority, product, expert, remarks, productCatalogId, isWorking,
            mobileNumber, customerName, customerCompanyName, customerCategory, businessCategory, state, city
        } = req.body;
        const createdBy = req.user?.accountId;

        if (!mobileNumber || !customerName) {
            return sendErrorResponse(res, 400, "Mobile number and customer name are required");
        }

        const normalizedMobile = mobileNumber.replace(/\D/g, "").slice(-10);
        let customer = await prisma.customer.findFirst({
            where: { mobile : normalizedMobile },
        });

        if (!customer) {
            customer = await prisma.customer.create({
                data: {
                    name: customerName,
                    mobile: normalizedMobile,
                    normalizedMobile: normalizedMobile,
                    customerCompanyName: customerCompanyName,
                    customerCategory: customerCategory || "OTHER",
                    businessCategory: businessCategory || "OTHER",
                    state,
                    city,
                },
            });
        }

        const support = await prisma.support.create({
            data: {
                subject,
                description,
                type,
                priority,
                customer: { connect: { id: customer.id } },
                product: product || null,
                productCatalogId: productCatalogId || null,
                productCatalog: productCatalogId ? { connect: { id: productCatalogId } } : undefined,
                isWorking: isWorking || false,
                expert: expert || null,
                remarks: remarks || null,
                createdByAcc: createdBy ? { connect: { id: createdBy } } : undefined,
                assignments: createdBy ? {
                    create: {
                        type: "ACCOUNT",
                        accountId: createdBy,
                        assignedBy: createdBy
                    }
                } : undefined,
                activityLogs: {
                    create: {
                        action: "CREATED",
                        performedByAccount: createdBy ? { connect: { id: createdBy } } : undefined,
                    }
                }
            },
            include: { customer: true, assignments: { include: { account: true, team: true } } }
        });

        try {
            const io = getIo();
            io.to("supports:admin").emit("support:created", support);
            if (createdBy) io.to(`supports:user:${createdBy}`).emit("support:created", support);
        } catch (e) {
            console.warn("Socket emit skipped", e);
        }

        return sendSuccessResponse(res, 201, "Support created successfully", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error creating support");
    }
}

export async function listSupportsAdmin(req: Request, res: Response) {
    try {
        const { status, customerId, assignedTo, search, fromDate, toDate, priority, type, isWorking, page = "1", limit = "20" } = req.query as any;
        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        const where: any = {};
        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (type) where.type = type;
        if (isWorking === "true") where.isWorking = true;
        if (isWorking === "false") where.isWorking = false;
        
        if (customerId) where.customerId = customerId;
        if (assignedTo) where.assignments = { some: { accountId: assignedTo, isActive: true } };

        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
            if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
        }

        if (search) {
            const lowerQuery = search.toLowerCase();
            where.OR = [
                { subject: { contains: lowerQuery, mode: 'insensitive' } },
                { description: { contains: lowerQuery, mode: 'insensitive' } },
                { customer: { name: { contains: lowerQuery, mode: 'insensitive' } } },
                { customer: { mobile: { contains: lowerQuery, mode: 'insensitive' } } },
                { customer: { customerCompanyName: { contains: lowerQuery, mode: 'insensitive' } } }
            ];
        }

        const [supports, total] = await Promise.all([
            prisma.support.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: "desc" },
                include: { customer: true, assignments: { include: { account: true } } }
            }),
            prisma.support.count({ where })
        ]);

        return sendSuccessResponse(res, 200, "Supports fetched successfully", { data: supports, meta: { total, page: Number(page), limit: Number(limit) } });
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error fetching supports");
    }
}

export async function getSupportCountByStatusAdmin(req: Request, res: Response) {
    try {
        const { fromDate, toDate, assignedTo, priority, type, isWorking, search } = req.query as Record<string, string>;

        const where: any = {};

        if (priority) where.priority = priority;
        if (type) where.type = type;
        if (isWorking === "true") where.isWorking = true;
        if (isWorking === "false") where.isWorking = false;

        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
            if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
        }

        if (assignedTo) {
            where.assignments = { some: { accountId: assignedTo, isActive: true } };
        }

        if (search) {
            const lowerQuery = search.toLowerCase();
            where.OR = [
                { subject: { contains: lowerQuery, mode: 'insensitive' } },
                { description: { contains: lowerQuery, mode: 'insensitive' } },
                { customer: { name: { contains: lowerQuery, mode: 'insensitive' } } },
                { customer: { mobile: { contains: lowerQuery, mode: 'insensitive' } } },
                { customer: { customerCompanyName: { contains: lowerQuery, mode: 'insensitive' } } }
            ];
        }

        const grouped = await prisma.support.groupBy({
            by: ["status"],
            where,
            _count: { _all: true },
        });

        const result = {
            OPEN: 0, IN_PROGRESS: 0, ON_HOLD: 0, WAITING_FOR_CUSTOMER: 0,
            SUPPORT_DONE: 0, NOT_DONE: 0, CANCELLED: 0, TOTAL: 0,
        };

        for (const row of grouped) {
            result[row.status as keyof typeof result] = row._count._all;
            result.TOTAL += row._count._all;
        }

        return sendSuccessResponse(res, 200, "Support counts fetched", result);
    } catch (err: any) {
        console.error("Support count by status error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch support counts");
    }
}

export async function getSupportCountByStatusUser(req: Request, res: Response) {
    try {
        const { fromDate, toDate, priority, type, isWorking, search } = req.query as Record<string, string>;
        const accountId = req.user?.accountId;

        const where: any = {
            OR: [
                { assignments: { some: { accountId, isActive: true } } },
                { createdBy: accountId }
            ]
        };

        if (priority) where.priority = priority;
        if (type) where.type = type;
        if (isWorking === "true") where.isWorking = true;
        if (isWorking === "false") where.isWorking = false;

        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
            if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
        }

        if (search) {
            const lowerQuery = search.toLowerCase();
            where.AND = [
                {
                    OR: [
                        { subject: { contains: lowerQuery, mode: 'insensitive' } },
                        { description: { contains: lowerQuery, mode: 'insensitive' } },
                        { customer: { name: { contains: lowerQuery, mode: 'insensitive' } } },
                        { customer: { mobile: { contains: lowerQuery, mode: 'insensitive' } } },
                        { customer: { customerCompanyName: { contains: lowerQuery, mode: 'insensitive' } } }
                    ]
                }
            ];
        }

        const grouped = await prisma.support.groupBy({
            by: ["status"],
            where,
            _count: { _all: true },
        });

        const result = {
            OPEN: 0, IN_PROGRESS: 0, ON_HOLD: 0, WAITING_FOR_CUSTOMER: 0,
            SUPPORT_DONE: 0, NOT_DONE: 0, CANCELLED: 0, TOTAL: 0,
        };

        for (const row of grouped) {
            result[row.status as keyof typeof result] = row._count._all;
            result.TOTAL += row._count._all;
        }

        return sendSuccessResponse(res, 200, "Support counts fetched", result);
    } catch (err: any) {
        console.error("Support count by status error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch support counts");
    }
}

export async function listSupportsUser(req: Request, res: Response) {
    try {
        const { status, search, fromDate, toDate, priority, type, isWorking, page = "1", limit = "20" } = req.query as any;
        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);
        const accountId = req.user?.accountId;

        const where: any = {
            OR: [
                { assignments: { some: { accountId, isActive: true } } },
                { createdBy: accountId }
            ]
        };
        
        if (status) where.status = status;
        if (priority) where.priority = priority;
        if (type) where.type = type;
        if (isWorking === "true") where.isWorking = true;
        if (isWorking === "false") where.isWorking = false;

        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
            if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
        }

        if (search) {
            const lowerQuery = search.toLowerCase();
            where.AND = [
                {
                    OR: [
                        { subject: { contains: lowerQuery, mode: 'insensitive' } },
                        { description: { contains: lowerQuery, mode: 'insensitive' } },
                        { customer: { name: { contains: lowerQuery, mode: 'insensitive' } } },
                        { customer: { mobile: { contains: lowerQuery, mode: 'insensitive' } } },
                        { customer: { customerCompanyName: { contains: lowerQuery, mode: 'insensitive' } } }
                    ]
                }
            ];
        }

        const [supports, total] = await Promise.all([
            prisma.support.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: "desc" },
                include: { customer: true, assignments: { include: { account: true } } }
            }),
            prisma.support.count({ where })
        ]);

        return sendSuccessResponse(res, 200, "Supports fetched successfully", { data: supports, meta: { total, page: Number(page), limit: Number(limit) } });
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error fetching supports");
    }
}

export async function getSupportDetailsAdmin(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const support = await prisma.support.findUnique({
            where: { id },
            include: {
                customer: true,
                assignments: { include: { account: true } },
                activityLogs: { include: { performedByAccount: true }, orderBy: { createdAt: 'desc' } },
                timeLogs: { include: { loggedByAccount: true }, orderBy: { loggedAt: 'desc' } },
                createdByAcc: true
            }
        });
        if (!support) return sendErrorResponse(res, 404, "Support not found");
        return sendSuccessResponse(res, 200, "Support fetched successfully", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error fetching support details");
    }
}

export async function getSupportDetailsUser(req: Request, res: Response) {
    // Same as admin but should ensure authorization
    try {
        const { id } = req.params;
        const accountId = req.user?.accountId;
        const support = await prisma.support.findUnique({
            where: { id },
            include: {
                customer: true,
                assignments: { include: { account: true } },
                activityLogs: { include: { performedByAccount: true }, orderBy: { createdAt: 'desc' } },
                timeLogs: { include: { loggedByAccount: true }, orderBy: { loggedAt: 'desc' } },
                createdByAcc: true
            }
        });
        if (!support) return sendErrorResponse(res, 404, "Support not found");
        
        const isAuthorized = support.createdBy === accountId || support.assignments.some(a => a.accountId === accountId && a.isActive);
        if (!isAuthorized) return sendErrorResponse(res, 403, "Unauthorized access to this support ticket");

        return sendSuccessResponse(res, 200, "Support fetched successfully", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error fetching support details");
    }
}

export async function updateSupportAdmin(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const data = req.body;
        const performedBy = req.user?.accountId;
        
        if (data.productCatalogId !== undefined) {
            data.productCatalog = data.productCatalogId ? { connect: { id: data.productCatalogId } } : { set: [] };
        }

        const support = await prisma.support.update({
            where: { id },
            data,
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "STATUS_CHANGED",
                performedBy: performedBy || null,
                meta: { updatedData: data }
            }
        });

        await emitSupportPatch(support.id, support);

        return sendSuccessResponse(res, 200, "Support updated successfully", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error updating support");
    }
}

export async function updateSupportUser(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { status } = req.body; // Users mostly only update status
        const performedBy = req.user?.accountId;

        const support = await prisma.support.update({
            where: { id },
            data: { status, closedAt: status === "SUPPORT_DONE" ? new Date() : null },
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "STATUS_CHANGED",
                performedBy: performedBy || null,
                meta: { status }
            }
        });

        await emitSupportPatch(support.id, support);

        return sendSuccessResponse(res, 200, "Support status updated successfully", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error updating support status");
    }
}

export async function assignSupportAdmin(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { accountId } = req.body;
        const assignedBy = req.user?.accountId;

        await prisma.supportAssignment.updateMany({
            where: { supportId: id, isActive: true },
            data: { isActive: false, unassignedAt: new Date() }
        });

        const assignment = await prisma.supportAssignment.create({
            data: {
                supportId: id,
                accountId,
                assignedBy
            }
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "ASSIGNED",
                performedBy: assignedBy || null,
                meta: { assignedTo: accountId }
            }
        });

        await emitSupportPatch(id, { id });

        return sendSuccessResponse(res, 200, "Support assigned successfully", assignment);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error assigning support");
    }
}

export async function logSupportTimeUser(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { seconds, remark } = req.body;
        const loggedBy = req.user?.accountId;

        const timeLog = await prisma.supportTimeLog.create({
            data: {
                supportId: id,
                seconds: Number(seconds),
                remark,
                loggedBy
            }
        });

        await prisma.support.update({
            where: { id },
            data: { totalWorkSeconds: { increment: Number(seconds) } }
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "TIME_LOGGED",
                performedBy: loggedBy || null,
                meta: { seconds }
            }
        });

        return sendSuccessResponse(res, 201, "Time logged successfully", timeLog);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error logging time");
    }
}

export async function addSupportRemarkAdmin(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { remark } = req.body; // Actually this could be 'text' or the whole object. Let's assume req.body contains text.
        const performedBy = req.user?.accountId;
        
        const text = req.body.text || remark;
        if (!text) return sendErrorResponse(res, 400, "Remark text is required");

        const support = await prisma.support.findUnique({ where: { id } });
        if (!support) return sendErrorResponse(res, 404, "Support not found");

        const account = performedBy ? await prisma.account.findUnique({ where: { id: performedBy } }) : null;

        const currentRemarks: any[] = Array.isArray(support.remarks) ? support.remarks : [];
        const newRemark = {
            id: require("crypto").randomUUID(),
            text,
            by: {
                accountId: performedBy,
                firstName: account?.firstName || "Unknown",
                lastName: account?.lastName || "",
                avatar: account?.avatar || null
            },
            at: new Date().toISOString()
        };

        // console.log("\n\n\n\n\n\n\nnewRemark->\n", newRemark)
        // console.log("\n\n account->\n", account)

        const updatedSupport = await prisma.support.update({
            where: { id },
            data: {
                remarks: [...currentRemarks, newRemark]
            },
            include: { customer: true, assignments: { include: { account: true, team: true } } }
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "REMARK_ADDED",
                performedBy: performedBy || null,
                meta: { remark: newRemark }
            }
        });

        await emitSupportPatch(id, { remarks: updatedSupport.remarks });

        return sendSuccessResponse(res, 201, "Remark added successfully", updatedSupport);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error adding remark");
    }
}


export async function editSupportRemarkAdmin(req: Request, res: Response) {
    try {
        const { id, remarkId } = req.params;
        const { text } = req.body;
        const performedBy = req.user?.accountId;
        
        if (!text) return sendErrorResponse(res, 400, "Remark text is required");

        const support = await prisma.support.findUnique({ where: { id } });
        if (!support) return sendErrorResponse(res, 404, "Support not found");

        const currentRemarks: any[] = Array.isArray(support.remarks) ? support.remarks : [];
        const remarkIndex = currentRemarks.findIndex(r => r.id === remarkId);
        
        if (remarkIndex === -1) return sendErrorResponse(res, 404, "Remark not found");
        
        // Ensure user can only edit their own remarks (unless Admin bypassing, but requirement says "only if they created that remark")
        if (currentRemarks[remarkIndex].by?.accountId !== performedBy) {
            return sendErrorResponse(res, 403, "You can only edit your own remarks");
        }

        currentRemarks[remarkIndex].text = text;

        const updatedSupport = await prisma.support.update({
            where: { id },
            data: { remarks: currentRemarks }
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "REMARK_ADDED", // Reusing this or could be REMARK_EDITED if added to enum, but let's just use string in meta if needed
                performedBy: performedBy || null,
                meta: { event: "REMARK_EDITED", remarkId }
            }
        });

        await emitSupportPatch(id, { remarks: updatedSupport.remarks });

        return sendSuccessResponse(res, 200, "Remark updated successfully", updatedSupport);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error updating remark");
    }
}

export async function deleteSupportRemarkAdmin(req: Request, res: Response) {
    try {
        const { id, remarkId } = req.params;
        const performedBy = req.user?.accountId;

        const support = await prisma.support.findUnique({ where: { id } });
        if (!support) return sendErrorResponse(res, 404, "Support not found");

        const currentRemarks: any[] = Array.isArray(support.remarks) ? support.remarks : [];
        const remarkIndex = currentRemarks.findIndex(r => r.id === remarkId);
        
        if (remarkIndex === -1) return sendErrorResponse(res, 404, "Remark not found");
        
        if (currentRemarks[remarkIndex].by?.accountId !== performedBy) {
            return sendErrorResponse(res, 403, "You can only delete your own remarks");
        }

        currentRemarks.splice(remarkIndex, 1);

        const updatedSupport = await prisma.support.update({
            where: { id },
            data: { remarks: currentRemarks }
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "REMARK_ADDED",
                performedBy: performedBy || null,
                meta: { event: "REMARK_DELETED", remarkId }
            }
        });

        await emitSupportPatch(id, { remarks: updatedSupport.remarks });

        return sendSuccessResponse(res, 200, "Remark deleted successfully", updatedSupport);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error deleting remark");
    }
}

export async function editSupportRemarkUser(req: Request, res: Response) {
    return editSupportRemarkAdmin(req, res);
}

export async function deleteSupportRemarkUser(req: Request, res: Response) {
    return deleteSupportRemarkAdmin(req, res);
}

export async function addSupportRemarkUser(req: Request, res: Response) {
    // Exact same logic as admin but potentially verifying auth.
    return addSupportRemarkAdmin(req, res);
}

// ==========================================
// WORK SESSION LOGIC
// ==========================================

export async function startSupportWorkAdmin(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const performedBy = req.user?.accountId;

        const support = await prisma.support.update({
            where: { id },
            data: {
                status: "IN_PROGRESS",
                isWorking: true,
                currentWorkSessionStart: new Date(),
            },
        });

        await prisma.supportActivityLog.create({
            data: {
                supportId: id,
                action: "TIME_LOGGED",
                performedBy: performedBy || null,
                meta: { event: "WORK_STARTED" }
            }
        });

        await emitSupportPatch(support.id, support);

        return sendSuccessResponse(res, 200, "Support work started", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error starting support work");
    }
}

export async function stopSupportWorkAdmin(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const performedBy = req.user?.accountId;

        const currentSupport = await prisma.support.findUnique({ where: { id } });
        if (!currentSupport) return sendErrorResponse(res, 404, "Support not found");

        let addedSeconds = 0;
        if (currentSupport.isWorking && currentSupport.currentWorkSessionStart) {
            const diff = new Date().getTime() - new Date(currentSupport.currentWorkSessionStart).getTime();
            addedSeconds = Math.floor(diff / 1000);
        }

        const support = await prisma.support.update({
            where: { id },
            data: {
                isWorking: false,
                currentWorkSessionStart: null,
                totalWorkSeconds: { increment: addedSeconds }
            },
        });

        if (addedSeconds > 0) {
            await prisma.supportTimeLog.create({
                data: {
                    supportId: id,
                    seconds: addedSeconds,
                    loggedBy: performedBy || null,
                    remark: "System logged session"
                }
            });
            await prisma.supportActivityLog.create({
                data: {
                    supportId: id,
                    action: "TIME_LOGGED",
                    performedBy: performedBy || null,
                    meta: { event: "WORK_STOPPED", seconds: addedSeconds }
                }
            });
        }

        await emitSupportPatch(support.id, support);

        return sendSuccessResponse(res, 200, "Support work stopped", support);
    } catch (error) {
        console.error(error);
        return sendErrorResponse(res, 500, "Error stopping support work");
    }
}

export const startSupportWorkUser = startSupportWorkAdmin;
export const stopSupportWorkUser = stopSupportWorkAdmin;
