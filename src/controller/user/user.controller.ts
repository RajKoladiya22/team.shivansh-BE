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

