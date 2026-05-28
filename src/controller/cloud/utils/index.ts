// // src/controller/cloud/utils/index.ts
// /**
//  * Cloud Service Utilities & Helpers
//  */

// import { CloudServiceType, CloudRenewalType } from "@prisma/client";

// // ============================================================================
// // PASSWORD ENCRYPTION / DECRYPTION
// // ============================================================================

// /**
//  * Encrypt sensitive data (passwords, admin secrets)
//  *
//  * NOTE: This is a placeholder. In production, use a proper encryption library:
//  *   - crypto (Node.js built-in with proper key derivation)
//  *   - libsodium.js / tweetnacl
//  *   - @noble/ciphers
//  *   - bcrypt (for hashing passwords, not encryption)
//  *
//  * Example with crypto:
//  * import crypto from 'crypto';
//  *
//  * const algorithm = 'aes-256-gcm';
//  * const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
//  * const iv = crypto.randomBytes(16);
//  *
//  * const cipher = crypto.createCipheriv(algorithm, key, iv);
//  * let encrypted = cipher.update(plaintext, 'utf8', 'hex');
//  * encrypted += cipher.final('hex');
//  * const authTag = cipher.getAuthTag();
//  * return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
//  */
// export function encryptPassword(plaintext: string): string {
//   // TODO: Implement actual encryption
//   // For now, return plaintext (UNSAFE - do not use in production)
//   console.warn("⚠️ WARNING: Password encryption not implemented. Using plaintext!");
//   return plaintext;
// }

// /**
//  * Decrypt sensitive data
//  */
// export function decryptPassword(encrypted: string): string {
//   // TODO: Implement actual decryption
//   return encrypted;
// }

// /**
//  * Hash password for login (one-way, cannot decrypt)
//  * Use for scenarios where you need to verify a password without storing it plaintext
//  */
// export function hashPassword(plaintext: string): string {
//   // TODO: Use bcrypt or argon2
//   // const bcrypt = require('bcrypt');
//   // return await bcrypt.hash(plaintext, 10);
//   console.warn("⚠️ WARNING: Password hashing not implemented!");
//   return plaintext;
// }

// // ============================================================================
// // VALIDATION HELPERS
// // ============================================================================

// export interface CloudServiceValidationResult {
//   valid: boolean;
//   errors: string[];
// }

// /**
//  * Validate Miracle Cloud service data
//  */
// export function validateMiracleCloud(data: {
//   cost?: number | null;
//   renewalType?: string;
//   ipAddress?: string;
//   adminPassword?: string;
//   userCount?: number;
//   users?: Array<{ username?: string; password: string; isAdmin?: boolean }>;
// }): CloudServiceValidationResult {
//   const errors: string[] = [];

//   if (!data.renewalType) {
//     errors.push("renewalType is required");
//   }

//   if (data.ipAddress && !isValidIPAddress(data.ipAddress)) {
//     errors.push("Invalid IP address format");
//   }

//   if (!data.adminPassword) {
//     errors.push("adminPassword is required for Miracle Cloud");
//   }

//   if (data.users) {
//     for (let i = 0; i < data.users.length; i++) {
//       const user = data.users[i];
//       if (!user.password) {
//         errors.push(`User ${i + 1}: password is required`);
//       }
//       if (!user.username) {
//         errors.push(`User ${i + 1}: username is required for Miracle Cloud`);
//       }
//     }
//   }

//   return { valid: errors.length === 0, errors };
// }

// /**
//  * Validate Comhard Cloud service data
//  */
// export function validateComhardCloud(data: {
//   cost?: number | null;
//   renewalType?: string;
//   comhardSubId?: string;
//   numberOfTally?: number;
//   isOnTrial?: boolean;
//   trialStartDate?: Date;
//   trialEndDate?: Date;
//   users?: Array<{ password: string; userEmail?: string; isAdmin?: boolean }>;
// }): CloudServiceValidationResult {
//   const errors: string[] = [];

//   if (!data.renewalType) {
//     errors.push("renewalType is required");
//   }

//   if (!data.comhardSubId) {
//     errors.push("comhardSubId is required for Comhard Cloud");
//   }

//   if (data.numberOfTally && ![1, 2].includes(data.numberOfTally)) {
//     errors.push("numberOfTally must be 1 or 2");
//   }

//   if (data.isOnTrial) {
//     if (!data.trialStartDate) {
//       errors.push("trialStartDate is required for trial");
//     }
//     if (!data.trialEndDate) {
//       errors.push("trialEndDate is required for trial");
//     }
//     // Trial should be 7 days max
//     if (data.trialStartDate && data.trialEndDate) {
//       const days = Math.ceil(
//         (data.trialEndDate.getTime() - data.trialStartDate.getTime()) /
//           (1000 * 60 * 60 * 24),
//       );
//       if (days > 7) {
//         errors.push("Trial duration cannot exceed 7 days");
//       }
//     }
//   }

//   if (data.users) {
//     for (let i = 0; i < data.users.length; i++) {
//       const user = data.users[i];
//       if (!user.password) {
//         errors.push(`User ${i + 1}: password is required`);
//       }
//       // For Comhard, email is preferred over username
//       if (!user.userEmail) {
//         errors.push(`User ${i + 1}: userEmail is required for Comhard Cloud`);
//       }
//     }
//   }

//   return { valid: errors.length === 0, errors };
// }

// /**
//  * Validate IP address (IPv4 or IPv6)
//  */
// function isValidIPAddress(ip: string): boolean {
//   // IPv4
//   const ipv4Regex =
//     /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
//   if (ipv4Regex.test(ip)) return true;

//   // IPv6 (simplified)
//   const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
//   return ipv6Regex.test(ip);
// }

// // ============================================================================
// // RENEWAL DATE CALCULATIONS
// // ============================================================================

// export interface RenewalInfo {
//   renewalDate: Date;
//   daysRemaining: number;
//   status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";
//   formattedDate: string;
// }

// /**
//  * Calculate renewal date and status
//  */
// export function calculateRenewalInfo(
//   purchaseDate: Date | null,
//   renewalType: CloudRenewalType,
// ): RenewalInfo | null {
//   if (!purchaseDate) {
//     return null;
//   }

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

//   const now = new Date();
//   const daysRemaining = Math.ceil(
//     (renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
//   );

//   let status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" = "ACTIVE";
//   if (daysRemaining < 0) {
//     status = "EXPIRED";
//   } else if (daysRemaining <= 30) {
//     status = "EXPIRING_SOON";
//   }

//   return {
//     renewalDate: renewal,
//     daysRemaining,
//     status,
//     formattedDate: renewal.toLocaleDateString("en-IN", {
//       year: "numeric",
//       month: "short",
//       day: "numeric",
//     }),
//   };
// }

// /**
//  * Get renewal type label
//  */
// export function getRenewalTypeLabel(renewalType: CloudRenewalType): string {
//   switch (renewalType) {
//     case "QUARTERLY":
//       return "Every 3 months";
//     case "SIX_MONTHS":
//       return "Every 6 months";
//     case "YEARLY":
//       return "Every year";
//   }
// }

// /**
//  * Get days in renewal period
//  */
// export function getDaysInRenewalPeriod(renewalType: CloudRenewalType): number {
//   switch (renewalType) {
//     case "QUARTERLY":
//       return 90; // ~3 months
//     case "SIX_MONTHS":
//       return 180; // ~6 months
//     case "YEARLY":
//       return 365; // ~12 months
//   }
// }

// // ============================================================================
// // TRIAL HELPERS
// // ============================================================================

// /**
//  * Check if trial is still active
//  */
// export function isTrialActive(
//   isOnTrial: boolean,
//   trialEndDate: Date | null,
//   trialDoneAt: Date | null,
// ): boolean {
//   if (!isOnTrial || trialDoneAt) return false;
//   if (!trialEndDate) return false;
//   return trialEndDate > new Date();
// }

// /**
//  * Calculate trial days remaining
//  */
// export function getTrialDaysRemaining(trialEndDate: Date | null): number | null {
//   if (!trialEndDate) return null;
//   const now = new Date();
//   if (trialEndDate < now) return 0;
//   return Math.ceil(
//     (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
//   );
// }

// /**
//  * Get trial progress percentage
//  */
// export function getTrialProgressPercent(
//   trialStartDate: Date | null,
//   trialEndDate: Date | null,
// ): number | null {
//   if (!trialStartDate || !trialEndDate) return null;

//   const totalDays =
//     (trialEndDate.getTime() - trialStartDate.getTime()) / (1000 * 60 * 60 * 24);
//   const elapsedDays =
//     (new Date().getTime() - trialStartDate.getTime()) / (1000 * 60 * 60 * 24);

//   return Math.min(100, Math.round((elapsedDays / totalDays) * 100));
// }

// // ============================================================================
// // COMHARD HELPERS
// // ============================================================================

// /**
//  * Get Comhard instance number label
//  */
// export function getComhardTallyLabel(tallyNumber: number | null): string {
//   if (!tallyNumber) return "Primary";
//   if (tallyNumber === 1) return "Tally 1";
//   if (tallyNumber === 2) return "Tally 2";
//   return `Tally ${tallyNumber}`;
// }

// /**
//  * Validate Comhard tally number
//  */
// export function isValidComhardTallyNumber(number: number | null): boolean {
//   if (number === null) return true; // null is valid (for single tally)
//   return number === 1 || number === 2;
// }

// // ============================================================================
// // SUMMARY & REPORTING
// // ============================================================================

// export interface CloudServiceSummary {
//   totalServices: number;
//   byType: {
//     miracle: number;
//     comhard: number;
//   };
//   byStatus: {
//     active: number;
//     expiring: number;
//     expired: number;
//   };
//   onTrial: number;
//   totalRevenue: number;
// }

// /**
//  * Generate cloud service summary
//  * (Use with aggregation query from controller)
//  */
// export function generateSummary(services: any[]): CloudServiceSummary {
//   let active = 0, expiring = 0, expired = 0, onTrial = 0, totalRevenue = 0;
//   let miracle = 0, comhard = 0;

//   for (const s of services) {
//     if (s.type === "MIRACLE") miracle++;
//     else if (s.type === "COMHARD") comhard++;

//     const info = calculateRenewalInfo(s.purchaseDate, s.renewalType);
//     if (info?.status === "ACTIVE") active++;
//     else if (info?.status === "EXPIRING_SOON") expiring++;
//     else if (info?.status === "EXPIRED") expired++;

//     if (isTrialActive(s.isOnTrial, s.trialEndDate, s.trialDoneAt)) onTrial++;
//     totalRevenue += s.cost || 0;
//   }

//   return {
//     totalServices: services.length,
//     byType: { miracle, comhard },
//     byStatus: { active, expiring, expired },
//     onTrial,
//     totalRevenue,
//   };
// }

// // ============================================================================
// // FORMAT HELPERS
// // ============================================================================

// /**
//  * Format cost in INR
//  */
// export function formatCostINR(cost: number | null | undefined): string {
//   if (cost == null) return "₹0";
//   return new Intl.NumberFormat("en-IN", {
//     style: "currency",
//     currency: "INR",
//     minimumFractionDigits: 0,
//   }).format(cost);
// }

// /**
//  * Format date for display
//  */
// export function formatDate(date: Date | null | undefined): string {
//   if (!date) return "-";
//   return new Date(date).toLocaleDateString("en-IN", {
//     year: "numeric",
//     month: "short",
//     day: "numeric",
//   });
// }

// /**
//  * Format date and time
//  */
// export function formatDateTime(date: Date | null | undefined): string {
//   if (!date) return "-";
//   return new Date(date).toLocaleDateString("en-IN", {
//     year: "numeric",
//     month: "short",
//     day: "numeric",
//     hour: "2-digit",
//     minute: "2-digit",
//   });
// }