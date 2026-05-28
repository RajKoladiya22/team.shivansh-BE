// // src/core/job/cloud/index.ts

// /**
//  * Cloud Service Renewal Reminder Cron Job
//  *
//  * Purpose: Automatically create SUPPORT type Leads for cloud services
//  * that are approaching renewal or already expired
//  *
//  * Schedule: Run daily at 9:00 AM (or adjust as needed)
//  * Example: 0 9 * * * (cron syntax)
//  *
//  * Use with: node-cron or similar scheduler
//  */

// import { prisma } from "../../../config/database.config";
// import { LeadSource, LeadType } from "@prisma/client";
// import { logger } from "../../help/logs/logger";


// /**
//  * Main function: Generate renewal reminders for cloud services
//  */
// export async function generateCloudServiceRenewalReminders() {
//   try {

//     logger.info("Starting cloud service renewal reminder job...");

//     const now = new Date();

//     /* ────────────────────────────────────────────────────────────
//        Query 1: Find services that are EXPIRING SOON (within 30 days)
//     ──────────────────────────────────────────────────────────────── */
//     const expiringServices = await prisma.$queryRaw<
//       Array<{
//         id: string;
//         customerId: string;
//         type: "MIRACLE" | "COMHARD";
//         purchaseDate: Date;
//         renewalType: "QUARTERLY" | "SIX_MONTHS" | "YEARLY";
//         customer_name: string;
//         customer_mobile: string;
//         customer_company: string | null;
//       }>
//     >`
//       SELECT
//         cs.id,
//         cs."customerId",
//         cs.type,
//         cs."purchaseDate",
//         cs."renewalType",
//         c.name as customer_name,
//         c.mobile as customer_mobile,
//         c."customerCompanyName" as customer_company
//       FROM "CloudService" cs
//       JOIN "Customer" c ON cs."customerId" = c.id
//       WHERE
//         cs."isActive" = true
//         AND cs."purchaseDate" IS NOT NULL
//         AND (
//           -- YEARLY renewals: due within next 30 days (10.5 to 11.5 months from now)
//           (
//             cs."renewalType" = 'YEARLY'
//             AND cs."purchaseDate" + INTERVAL '10.5 months' < ${now}
//             AND cs."purchaseDate" + INTERVAL '11.5 months' > ${now}
//           )
//           OR
//           -- SIX_MONTHS renewals: due within next 30 days (5.5 to 6.5 months)
//           (
//             cs."renewalType" = 'SIX_MONTHS'
//             AND cs."purchaseDate" + INTERVAL '5.5 months' < ${now}
//             AND cs."purchaseDate" + INTERVAL '6.5 months' > ${now}
//           )
//           OR
//           -- QUARTERLY renewals: due within next 30 days (2.5 to 3.5 months)
//           (
//             cs."renewalType" = 'QUARTERLY'
//             AND cs."purchaseDate" + INTERVAL '2.5 months' < ${now}
//             AND cs."purchaseDate" + INTERVAL '3.5 months' > ${now}
//           )
//         )
//       ORDER BY cs."purchaseDate" ASC
//     `;

//     logger.info(`Found ${expiringServices.length} services expiring soon`);

//     /* ────────────────────────────────────────────────────────────
//        Query 2: Find services that are ALREADY EXPIRED
//        (renewal date has passed, and no recent reminder lead exists)
//     ──────────────────────────────────────────────────────────────── */
//     const expiredServices = await prisma.$queryRaw<
//       Array<{
//         id: string;
//         customerId: string;
//         type: "MIRACLE" | "COMHARD";
//         purchaseDate: Date;
//         renewalType: "QUARTERLY" | "SIX_MONTHS" | "YEARLY";
//         customer_name: string;
//         customer_mobile: string;
//         customer_company: string | null;
//       }>
//     >`
//       SELECT
//         cs.id,
//         cs."customerId",
//         cs.type,
//         cs."purchaseDate",
//         cs."renewalType",
//         c.name as customer_name,
//         c.mobile as customer_mobile,
//         c."customerCompanyName" as customer_company
//       FROM "CloudService" cs
//       JOIN "Customer" c ON cs."customerId" = c.id
//       WHERE
//         cs."isActive" = true
//         AND cs."purchaseDate" IS NOT NULL
//         AND (
//           -- YEARLY: already expired
//           (
//             cs."renewalType" = 'YEARLY'
//             AND cs."purchaseDate" + INTERVAL '1 year' < ${now}
//           )
//           OR
//           -- SIX_MONTHS: already expired
//           (
//             cs."renewalType" = 'SIX_MONTHS'
//             AND cs."purchaseDate" + INTERVAL '6 months' < ${now}
//           )
//           OR
//           -- QUARTERLY: already expired
//           (
//             cs."renewalType" = 'QUARTERLY'
//             AND cs."purchaseDate" + INTERVAL '3 months' < ${now}
//           )
//         )
//       ORDER BY cs."purchaseDate" ASC
//     `;

//     logger.info(`Found ${expiredServices.length} services already expired`);

//     /* ────────────────────────────────────────────────────────────
//        Check for existing reminders to avoid duplicates
//        (Look for recent SUPPORT type leads linked to cloud service)
//     ──────────────────────────────────────────────────────────────── */
//     const existingReminderIds = await prisma.$queryRaw<{ id: string }[]>`
//       SELECT DISTINCT cs.id
//       FROM "CloudService" cs
//       JOIN "Lead" l ON l."leadId" = cs.id
//       WHERE
//         l.type = 'SUPPORT'
//         AND l.status IN ('PENDING', 'IN_PROGRESS', 'FOLLOW_UPS')
//         AND l."createdAt" > ${new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)} -- Within last 7 days
//     `;

//     const existingIds = new Set(existingReminderIds.map((r) => r.id));

//     /* ────────────────────────────────────────────────────────────
//        Create leads for services without recent reminders
//     ──────────────────────────────────────────────────────────────── */
//     const createPromises = [];

//     for (const service of expiringServices) {
//       if (existingIds.has(service.id)) {
//         logger.info(
//           `Reminder already exists for ${service.type} service (${service.id}), skipping`,
//         );
//         continue;
//       }

//       const renewalDate = calculateRenewalDate(
//         service.purchaseDate,
//         service.renewalType,
//       );

//       createPromises.push(
//         prisma.lead.create({
//           data: {
//             source: LeadSource.SYSTEM_AUTO,
//             type: LeadType.SUPPORT,
//             status: "PENDING",
//             customerId: service.customerId,
//             cloudServices: {
//               connect: [{ id: service.id }],
//             },
//             customerName: service.customer_name,
//             mobileNumber: service.customer_mobile,
//             customerCompanyName: service.customer_company || undefined,
//             productTitle: `${service.type} Cloud Renewal Reminder`,
//             remark: `${service.type} Cloud renewal due on ${renewalDate?.toLocaleDateString() || "N/A"}. Renewal Type: ${service.renewalType}`,
//             createdBy: "SYSTEM", // or use a system account ID
//           },
//         }),
//       );
//     }

//     for (const service of expiredServices) {
//       if (existingIds.has(service.id)) {
//         logger.info(
//           `Reminder already exists for ${service.type} service (${service.id}), skipping`,
//         );
//         continue;
//       }

//       createPromises.push(
//         prisma.lead.create({
//           data: {
//             source: LeadSource.SYSTEM_AUTO,
//             type: LeadType.SUPPORT,
//             status: "PENDING",
//             customerId: service.customerId,
//             cloudServices: {
//               connect: [{ id: service.id }],
//             },
//             customerName: service.customer_name,
//             mobileNumber: service.customer_mobile,
//             customerCompanyName: service.customer_company || undefined,
//             productTitle: `${service.type} Cloud Renewal OVERDUE`,
//             remark: `URGENT: ${service.type} Cloud renewal is OVERDUE. Purchase date: ${service.purchaseDate?.toLocaleDateString() || "N/A"}`,
//             createdBy: "SYSTEM",
//           },
//         }),
//       );
//     }

//     if (createPromises.length > 0) {
//       const results = await Promise.all(createPromises);
//       logger.info(`Created ${results.length} renewal reminder leads`);
//     } else {
//       logger.info("No new reminders needed");
//     }

//     logger.info("Cloud service renewal reminder job completed successfully");
//     return {
//       success: true,
//       expiringCount: expiringServices.length - existingIds.size,
//       expiredCount: expiredServices.length - existingIds.size,
//       remindersCreated: createPromises.length,
//     };
//   } catch (error: any) {
//     console.error("Cloud service renewal reminder job failed:", error);
//     throw error;
//   }
// }

// /**
//  * Calculate renewal date based on purchaseDate and renewalType
//  */
// function calculateRenewalDate(
//   purchaseDate: Date,
//   renewalType: "QUARTERLY" | "SIX_MONTHS" | "YEARLY",
// ): Date {
//   const renewal = new Date(purchaseDate);

//   switch (renewalType) {
//     case "QUARTERLY":
//       renewal.setMonth(renewal.getMonth() + 3);
//       break;
//     case "SIX_MONTHS":
//       renewal.setMonth(renewal.getMonth() + 6);
//       break;
//     case "YEARLY":
//       renewal.setFullYear(renewal.getFullYear() + 1);
//       break;
//   }

//   return renewal;
// }

// /**
//  * Optional: Trial expiration reminder
//  * Creates a SUPPORT lead for trials ending in 1-3 days
//  */
// export async function generateTrialExpirationReminders() {
//   try {
//     logger.info("Starting cloud service trial expiration reminder job...");

//     const now = new Date();
//     const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
//     const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

//     /* ────────────────────────────────────────────────────────────
//        Find trials ending in the next 3 days (without recent reminders)
//     ──────────────────────────────────────────────────────────────── */
//     const trialsExpiringSoon = await prisma.$queryRaw<
//       Array<{
//         id: string;
//         customerId: string;
//         type: "MIRACLE" | "COMHARD";
//         trialEndDate: Date;
//         customer_name: string;
//         customer_mobile: string;
//       }>
//     >`
//       SELECT
//         cs.id,
//         cs."customerId",
//         cs.type,
//         cs."trialEndDate",
//         c.name as customer_name,
//         c.mobile as customer_mobile
//       FROM "CloudService" cs
//       JOIN "Customer" c ON cs."customerId" = c.id
//       WHERE
//         cs."isOnTrial" = true
//         AND cs."trialDoneAt" IS NULL
//         AND cs."trialEndDate" IS NOT NULL
//         AND cs."trialEndDate" BETWEEN ${tomorrow} AND ${threeDaysFromNow}
//     `;

//     logger.info(`Found ${trialsExpiringSoon.length} trials expiring soon`);

//     const existingReminderIds = await prisma.$queryRaw<{ id: string }[]>`
//       SELECT DISTINCT cs.id
//       FROM "CloudService" cs
//       JOIN "Lead" l ON l."leadId" = cs.id
//       WHERE
//         l.type = 'SUPPORT'
//         AND l."productTitle" ILIKE '%trial%'
//         AND l.status IN ('PENDING', 'IN_PROGRESS')
//         AND l."createdAt" > ${new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)}
//     `;

//     const existingIds = new Set(existingReminderIds.map((r) => r.id));

//     /* ────────────────────────────────────────────────────────────
//        Create reminder leads
//     ──────────────────────────────────────────────────────────────── */
//     const createPromises = [];

//     for (const trial of trialsExpiringSoon) {
//       if (existingIds.has(trial.id)) {
//         logger.info(
//           `Trial reminder already exists for service ${trial.id}, skipping`,
//         );
//         continue;
//       }

//       const daysLeft = Math.ceil(
//         (trial.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
//       );

//       createPromises.push(
//         prisma.lead.create({
//           data: {
//             source: LeadSource.SYSTEM_AUTO,
//             type: LeadType.SUPPORT,
//             status: "PENDING",
//             customerId: trial.customerId,
//             cloudServices: {
//               connect: [{ id: trial.id }],
//             },
//             customerName: trial.customer_name,
//             mobileNumber: trial.customer_mobile,
//             productTitle: `${trial.type} Cloud Trial Expiring`,
//             remark: `Trial ends in ${daysLeft} days (${trial.trialEndDate.toLocaleDateString()}). Follow up for conversion.`,
//             createdBy: "SYSTEM",
//           },
//         }),
//       );
//     }

//     if (createPromises.length > 0) {
//       await Promise.all(createPromises);
//       logger.info(`Created ${createPromises.length} trial expiration reminders`);
//     } else {
//       logger.info("No trial expiration reminders needed");
//     }

//     return {
//       success: true,
//       trialsExpiring: trialsExpiringSoon.length - existingIds.size,
//       remindersCreated: createPromises.length,
//     };
//   } catch (error: any) {
//     console.error("Cloud service trial expiration reminder job failed:", error);
//     throw error;
//   }
// }

// /**
//  * Example setup with node-cron:
//  *
//  * import cron from 'node-cron';
//  * import {
//  *   generateCloudServiceRenewalReminders,
//  *   generateTrialExpirationReminders
//  * } from './cloud-service.cron';
//  *
//  * // Run renewal reminders daily at 9 AM
//  * cron.schedule('0 9 * * *', async () => {
//  *   try {
//  *     await generateCloudServiceRenewalReminders();
//  *   } catch (error) {
//  *     console.error('Renewal reminder cron failed:', error);
//  *   }
//  * });
//  *
//  * // Run trial expiration reminders daily at 10 AM
//  * cron.schedule('0 10 * * *', async () => {
//  *   try {
//  *     await generateTrialExpirationReminders();
//  *   } catch (error) {
//  *     console.error('Trial expiration cron failed:', error);
//  *   }
//  * });
//  */