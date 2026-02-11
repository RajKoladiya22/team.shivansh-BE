// src/controller/user/user.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { v4 as uuid } from "uuid";
import path from "path";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { buildFileUrl } from "../../core/middleware/multer/fileUrl";
import { safeUnlink } from "../../core/middleware/multer/fileCleanup";
import { getIo } from "../../core/utils/socket";

/* ===== KEEP AS-IS ===== */
interface BIODetails {
  dob?: string;
  familyContactName?: string;
  familyContactRelation?: string;
  familyContactNo?: string;
  whatsappNo?: string;
  bloodGroup?: string;
  gender?: string;
  referredBy?: string;
}

interface AddressDetails {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
}

/* ===== DOCUMENT META ===== */
interface DocumentMeta {
  id: string;
  key: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string | null;
  uploadedAt: string;
}

export async function updateProfile(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      firstName,
      lastName,
      contactEmail,
      contactPhone,
      bio,
      address,
      documentsToDelete,
    } = req.body;

    // console.log("\nReceived body:", req.body);

    /* ---------- PARSE JSON FIELDS ---------- */
    const parseJSON = <T>(value?: any): T | undefined => {
      if (!value) return;
      if (typeof value === "string") return JSON.parse(value);
      return value;
    };

    const bioData = parseJSON<BIODetails>(bio);
    const addressData = parseJSON<AddressDetails>(address);

    const rawDelete = parseJSON<string | string[]>(documentsToDelete);

    const deleteKeys: string[] = Array.isArray(rawDelete)
      ? rawDelete
      : rawDelete
        ? [rawDelete]
        : [];

    // console.log("\nParsed delete keys:", deleteKeys);

    /* ---------- FETCH ACCOUNT ---------- */
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return sendErrorResponse(res, 404, "User not found");

    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
    });
    if (!account) return sendErrorResponse(res, 404, "Account not found");

    const storageDir = path.join(process.cwd(), "src/storage", userId);

    /* ---------- DOCUMENT MAP ---------- */
    const docs: Record<string, DocumentMeta> = (account.documents as any) ?? {};

    /* ---------- DELETE REQUESTED DOCS ---------- */
    for (const key of deleteKeys) {
      if (docs[key]) {
        // console.log("\nDeleting document:", key, docs[key]);
        // console.log("\n storageDir:", storageDir);

        safeUnlink(path.join(storageDir, docs[key].filename));
        delete docs[key];
      }
    }

    /* ---------- HANDLE UPLOADS ---------- */
    const files = req.files as
      | Record<string, Express.Multer.File[]>
      | undefined;

    if (files) {
      for (const [key, arr] of Object.entries(files)) {
        const file = arr[0];
        if (!file) continue;

        // remove old if exists
        if (docs[key]) {
          safeUnlink(path.join(storageDir, docs[key].filename));
        }

        docs[key] = {
          id: uuid(),
          key,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: `storage/${userId}/${file.filename}`,
          url: buildFileUrl(req, userId, file.filename),
          uploadedAt: new Date().toISOString(),
        };
      }
    }

    /* ---------- UPDATE ---------- */
    const updated = await prisma.account.update({
      where: { id: account.id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(contactEmail && { contactEmail }),
        ...(contactPhone && { contactPhone }),
        ...(bioData && { bio: bioData }),
        ...(addressData && { address: addressData }),
        ...(docs["avatar"]?.filename && { avatar: docs["avatar"].url }),
        documents: docs,
      },
    });

    sendSuccessResponse(res, 200, "Profile updated successfully", updated);
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Internal server error");
  }
}

export async function getProfile(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    // console.log("\n\n\nuserId:=====>", userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return sendErrorResponse(res, 404, "User not found");
    }

    const account = await prisma.account.findUnique({
      where: { id: user.accountId },
    });

    if (!account) {
      return sendErrorResponse(res, 404, "Account not found");
    }

    sendSuccessResponse(res, 200, "Profile fetched", {
      ...account,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return sendErrorResponse(res, 500, "Failed to fetch profile");
  }
}

// /**
//  * PATCH /user/account/busy
//  * Body: { isBusy: boolean }
//  */
// export async function updateMyBusyStatus(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const { isBusy } = req.body as { isBusy: boolean };
//     if (typeof isBusy !== "boolean") {
//       return sendErrorResponse(res, 400, "isBusy must be boolean");
//     }

//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       select: { accountId: true },
//     });
//     if (!user?.accountId) {
//       return sendErrorResponse(res, 400, "Invalid account");
//     }

//     const account = await prisma.account.update({
//       where: { id: user.accountId },
//       data: { isBusy },
//       select: {
//         id: true,
//         isBusy: true,
//         firstName: true,
//         lastName: true,
//       },
//     });

//     /** 🔔 emit socket event */
//     const io = getIo();
//     io.emit("busy:changed", {
//       accountId: account.id,
//       isBusy: account.isBusy,
//       source: "MANUAL",
//     });

//     return sendSuccessResponse(res, 200, "Busy status updated", account);
//   } catch (err: any) {
//     console.error("updateMyBusyStatus error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to update busy");
//   }
// }

/**
 * PATCH /user/account/busy
 * Body: { isBusy: boolean; reason?: string }
 */
// export async function updateMyBusyStatus(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const { isBusy, reason } = req.body as {
//       isBusy: boolean;
//       reason?: string;
//     };

//     if (typeof isBusy !== "boolean") {
//       return sendErrorResponse(res, 400, "isBusy must be boolean");
//     }

//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       select: { accountId: true },
//     });

//     if (!user?.accountId) {
//       return sendErrorResponse(res, 400, "Invalid account");
//     }

//     /**
//      * 🔒 Atomic operation
//      */
//     const result = await prisma.$transaction(async (tx) => {
//       // 1. Get current state
//       const current = await tx.account.findUnique({
//         where: { id: user.accountId },
//         select: { id: true, isBusy: true },
//       });

//       if (!current) throw new Error("Account not found");

//       // ⛔ No-op protection (prevents duplicate logs)
//       if (current.isBusy === isBusy) {
//         return {
//           account: current,
//           skipped: true,
//         };
//       }

//       // 2. Update account
//       const updatedAccount = await tx.account.update({
//         where: { id: user.accountId },
//         data: { isBusy },
//         select: {
//           id: true,
//           isBusy: true,
//           firstName: true,
//           lastName: true,
//         },
//       });

//       // 3. Create busy activity log
//       await tx.busyActivityLog.create({
//         data: {
//           accountId: user.accountId,
//           fromBusy: current.isBusy,
//           toBusy: isBusy,
//           reason: reason ?? "MANUAL",
//         },
//       });

//       return {
//         account: updatedAccount,
//         skipped: false,
//       };
//     });

//     /**
//      * 🔔 Emit socket only if state changed
//      */
//     if (!result.skipped) {
//       const io = getIo();
//       io.emit("busy:changed", {
//         accountId: result.account.id,
//         isBusy: result.account.isBusy,
//         source: reason ?? "MANUAL",
//       });
//     }

//     return sendSuccessResponse(
//       res,
//       200,
//       result.skipped
//         ? "Busy status unchanged"
//         : "Busy status updated",
//       result.account,
//     );
//   } catch (err: any) {
//     console.error("updateMyBusyStatus error:", err);
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to update busy status",
//     );
//   }
// }

export async function updateMyBusyStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { isBusy, reason } = req.body as {
      isBusy: boolean;
      reason?: string;
    };

    if (typeof isBusy !== "boolean") {
      return sendErrorResponse(res, 400, "isBusy must be boolean");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountId: true },
    });

    if (!user?.accountId) {
      return sendErrorResponse(res, 400, "Invalid account");
    }

    const now = new Date();
    let tag: boolean = false;

    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({
        where: { id: user.accountId },
        select: {
          id: true,
          isBusy: true,
          activeLeadId: true,
        },
      });

      if (!account) throw new Error("Account not found");

      // ⛔ No-op protection
      if (account.isBusy === isBusy && !account.activeLeadId) {
        return { skipped: true, account };
      }

      /* =====================================================
         🛑 AUTO-STOP LEAD WORK (CRITICAL FIX)
      ===================================================== */
      if (account.activeLeadId && isBusy === false) {
        const leadId = account.activeLeadId;
        tag = leadId ? true : false;

        const lastStart = await tx.leadActivityLog.findFirst({
          where: {
            leadId,
            performedBy: account.id,
            action: "WORK_STARTED",
          },
          orderBy: { createdAt: "desc" },
        });

        let durationSeconds = 0;
        let startedAtIso: string | null = null;

        if (lastStart?.meta && typeof lastStart.meta === "object") {
          startedAtIso =
            (lastStart.meta as any).startedAt ??
            lastStart.createdAt.toISOString();
        }

        if (startedAtIso) {
          const startedAt = new Date(startedAtIso);
          if (!isNaN(startedAt.getTime())) {
            durationSeconds = Math.max(
              0,
              Math.floor((now.getTime() - startedAt.getTime()) / 1000),
            );
          }
        }

        // 🔻 END WORK
        await tx.leadActivityLog.create({
          data: {
            leadId,
            action: "WORK_ENDED",
            performedBy: account.id,
            meta: {
              startedAt: startedAtIso,
              endedAt: now.toISOString(),
              durationSeconds,
              autoStopped: true,
              reason: reason ?? "MANUAL_BUSY_CHANGE",
            },
          },
        });

        await tx.lead.update({
          where: { id: leadId },
          data: {
            totalWorkSeconds: { increment: durationSeconds },
            isWorking: false,
          },
        });

        // clear active lead
        await tx.account.update({
          where: { id: account.id },
          data: {
            activeLeadId: null,
          },
        });
      }

      /* =====================================================
         UPDATE BUSY STATE
      ===================================================== */
      const updatedAccount = await tx.account.update({
        where: { id: account.id },
        data: { isBusy },
        select: { id: true, isBusy: true },
      });

      await tx.busyActivityLog.create({
        data: {
          accountId: account.id,
          fromBusy: account.isBusy,
          toBusy: isBusy,
          reason: reason ?? "MANUAL",
        },
      });

      return {
        skipped: false,
        account: updatedAccount,
      };
    });

    /* =====================================================
       SOCKET EVENT
      ===================================================== */
    if (!result.skipped) {
      getIo().emit("busy:changed", {
        accountId: result.account.id,
        leadId: tag,
        isBusy: result.account.isBusy,
        source: reason ?? "MANUAL",
      });
    }

    return sendSuccessResponse(
      res,
      200,
      result.skipped ? "Busy status unchanged" : "Busy status updated",
      result.account,
    );
  } catch (err: any) {
    console.error("updateMyBusyStatus error:", err);
    return sendErrorResponse(res, 500, err.message);
  }
}
