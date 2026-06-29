import { Request, Response } from "express";
// import prisma from "../../core/prisma/prisma";
// import { sendErrorResponse, sendSuccessResponse } from "../../core/response/response";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { generateRenewalReminderEmailHtml, generateRenewalReminderEmailText } from "../../core/mailer/renewalReminderEmail";
import { sendMail } from "../../core/mailer";

export async function getUpcomingRenewals(req: Request, res: Response) {
    try {
        const { days } = req.query;
        
        let dateFilter = {};
        if (days && !isNaN(Number(days))) {
            const numDays = Number(days);
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + numDays);
            
            dateFilter = {
                billingDate: {
                    lte: targetDate,
                }
            };
        }

        const services = await prisma.cloudService.findMany({
            where: {
                isActive: true,
                ...dateFilter
            },
            include: {
                customer: {
                    select: {
                        id: true,
                        name: true,
                        customerCompanyName: true,
                        email: true,
                    }
                }
            },
            orderBy: {
                billingDate: 'asc'
            }
        });

        const today = new Date();
        const results = services.map(s => {
            let daysRemaining;
            if (s.billingDate) {
                const diffTime = new Date(s.billingDate).getTime() - today.getTime();
                daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }
            return {
                ...s,
                daysRemaining
            };
        });

        return sendSuccessResponse(res, 200, "Upcoming renewals fetched", results);
    } catch (error: any) {
        console.error("Get upcoming renewals error:", error);
        return sendErrorResponse(res, 500, "Failed to fetch upcoming renewals");
    }
}

export async function sendRenewalReminders(req: Request, res: Response) {
    try {
        const { cloudServiceIds } = req.body;

        if (!Array.isArray(cloudServiceIds) || cloudServiceIds.length === 0) {
            return sendErrorResponse(res, 400, "cloudServiceIds array is required");
        }

        const services = await prisma.cloudService.findMany({
            where: {
                id: { in: cloudServiceIds }
            },
            include: {
                customer: true
            }
        });

        const results = {
            success: 0,
            failed: 0,
            errors: [] as any[]
        };

        const today = new Date();

        for (const service of services) {
            try {
                if (!service.customer?.email) {
                    throw new Error(`Customer has no email address`);
                }

                let daysRemaining = 0;
                if (service.billingDate) {
                    const diffTime = new Date(service.billingDate).getTime() - today.getTime();
                    daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                const data = {
                    customerName: service.customer?.name || 'Customer',
                    customerCompanyName: service.customer?.customerCompanyName || undefined,
                    contactPerson: service.customer?.contactPerson || undefined,
                    serviceType: service.type,
                    billingDate: service.billingDate ? service.billingDate.toISOString() : new Date().toISOString(),
                    expiryDate: service.expiryDate ? service.expiryDate.toISOString() : undefined,
                    daysRemaining,
                };

                const html = generateRenewalReminderEmailHtml(data);
                const text = generateRenewalReminderEmailText(data);
                
                const subject = `Action Required: Your ${service.type} service renewal is due`;

                await sendMail(service.customer.email, subject, html, text);

                await prisma.cloudService.update({
                    where: { id: service.id },
                    data: { lastReminderSentAt: new Date() }
                });

                results.success++;
            } catch (err: any) {
                results.failed++;
                results.errors.push({
                    cloudServiceId: service.id,
                    error: err.message
                });
            }
        }

        return sendSuccessResponse(res, 200, "Reminders processed", results);
    } catch (error: any) {
        console.error("Send renewal reminders error:", error);
        return sendErrorResponse(res, 500, "Failed to send renewal reminders");
    }
}
