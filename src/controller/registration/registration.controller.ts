import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { sendMail } from "../../core/mailer";
import { welcomeEmployeeHtml } from "../../core/mailer/templates";
import { generateUniqueUsername } from "../../core/utils/username.util";

/* =====================================================
   REGISTER EMPLOYEE (CREATE REGISTRATION REQUEST ONLY)
===================================================== */
export async function registerEmployee(req: Request, res: Response) {
  try {
    const { firstName, lastName, email, phone } = req.body;
    // console.log("\n\n\n--->\n\n\n\n");
    

    if (!firstName || !lastName || !email || !phone) {
      return sendErrorResponse(res, 400, "All fields are required");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedPhone = phone.trim();

    /* ---- Already approved employee ---- */
    const existingAccount = await prisma.account.findFirst({
      where: {
        OR: [
          { contactEmail: normalizedEmail },
          { contactPhone: normalizedPhone },
        ],
      },
    });

    if (existingAccount) {
      return sendErrorResponse(
        res,
        409,
        "Employee already exists with this email or phone"
      );
    }

    /* ---- Existing pending request ---- */
    const existingPending = await prisma.registrationRequest.findFirst({
      where: {
        OR: [
          { contactEmail: normalizedEmail },
          { contactPhone: normalizedPhone },
        ],
        status: "PENDING",
      },
    });

    if (existingPending) {
      return sendErrorResponse(
        res,
        409,
        "A registration request is already pending"
      );
    }

    await prisma.registrationRequest.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        contactEmail: normalizedEmail,
        contactPhone: normalizedPhone,
        status: "PENDING",
      },
    });

    return sendSuccessResponse(
      res,
      201,
      "Registration request submitted successfully"
    );
  } catch (error) {
    console.error("registerEmployee error:", error);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}

/* =====================================================
   APPROVE REGISTRATION (CREATE ACCOUNT + USER)
===================================================== */
export async function approveRegistration(req: Request, res: Response) {
  try {
    const adminId = (req as any).user.id;
    const { id } = req.params;
    const { designation, jobType, roleId, joinedAt } = req.body;

    if (!designation || !jobType || !roleId) {
      return sendErrorResponse(res, 400, "Missing approval details");
    }

    const request = await prisma.registrationRequest.findUnique({
      where: { id },
    });

    if (!request || request.status !== "PENDING") {
      return sendErrorResponse(res, 404, "Invalid or processed request");
    }

    /* ---- Safety duplicate check ---- */
    const duplicateAccount = await prisma.account.findFirst({
      where: {
        OR: [
          { contactEmail: request.contactEmail ?? "" },
          { contactPhone: request.contactPhone ?? "" },
        ],
      },
    });

    if (duplicateAccount) {
      return sendErrorResponse(
        res,
        409,
        "Account already exists for this email or phone"
      );
    }

    /* ---- Credentials ---- */
    const tempPassword = crypto.randomBytes(6).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const username = await generateUniqueUsername(request.firstName || "user");

    const { account, user } = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          firstName: request.firstName!,
          lastName: request.lastName!,
          contactEmail: request.contactEmail!,
          contactPhone: request.contactPhone!,
          designation,
          jobType,
          joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
          isActive: true,
        },
      });

      const user = await tx.user.create({
        data: {
          accountId: account.id,
          username,
          passwordHash,
          mustChangePassword: true,
        },
      });

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId,
        },
      });

      await tx.registrationRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          decidedAt: new Date(),
          decidedBy: adminId,
          accountId: account.id,
        },
      });

      return { account, user };
    });

    /* ---- Email AFTER commit ---- */
    const html = welcomeEmployeeHtml(
      account.firstName,
      account.contactEmail,
      user.username ?? "-",
      tempPassword,
      "https://team.shivanshinfosys.in/login"
    );

    await sendMail(
      account.contactEmail,
      "Your Shivansh Team Account Is Ready",
      html
    );

    return sendSuccessResponse(
      res,
      200,
      "Employee approved and onboarded successfully"
    );
  } catch (error) {
    console.error("approveRegistration error:", error);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}

/* =====================================================
   REJECT REGISTRATION (NO DELETES)
===================================================== */
export async function rejectRegistration(req: Request, res: Response) {
  try {
    const adminId = (req as any).user.id;
    const { id } = req.params;

    const request = await prisma.registrationRequest.findUnique({
      where: { id },
    });

    if (!request || request.status !== "PENDING") {
      return sendErrorResponse(res, 404, "Invalid or processed request");
    }

    await prisma.registrationRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
        decidedBy: adminId,
      },
    });

    return sendSuccessResponse(res, 200, "Registration request rejected");
  } catch (error) {
    console.error("rejectRegistration error:", error);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}

/* =====================================================
   LIST REGISTRATIONS (DEFAULT = PENDING)
===================================================== */
export async function listRegistrations(req: Request, res: Response) {
  try {
    const statusQuery = (req.query.status as string)?.toUpperCase();
    const search = (req.query.search as string)?.trim();

    const allowedStatuses = ["PENDING", "APPROVED", "REJECTED"];
    let statusFilter: any = { status: "PENDING" };

    if (statusQuery === "ALL") {
      statusFilter = {};
    } else if (allowedStatuses.includes(statusQuery)) {
      statusFilter = { status: statusQuery };
    } else if (statusQuery) {
      return sendErrorResponse(res, 400, "Invalid status");
    }

    const searchFilter = search
      ? {
          OR: [
            { firstName: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { lastName: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { contactEmail: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { contactPhone: { contains: search, mode: Prisma.QueryMode.insensitive } },
            search.includes(" ")
              ? {
                  AND: [
                    {
                      firstName: {
                        contains: search.split(" ")[0],
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                    {
                      lastName: {
                        contains: search.split(" ").slice(1).join(" "),
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                  ],
                }
              : undefined,
          ].filter(Boolean),
        }
      : undefined;

    const registrations = await prisma.registrationRequest.findMany({
      where: {
        ...statusFilter,
        ...(searchFilter && searchFilter),
      },
      orderBy: { requestedAt: "desc" },
    });

    return sendSuccessResponse(
      res,
      200,
      `${statusQuery || "PENDING"} registrations fetched`,
      registrations
    );
  } catch (error) {
    console.error("listRegistrations error:", error);
    return sendErrorResponse(res, 500, "Internal server error");
  }
}


// export async function listRegistrations(req: Request, res: Response) {
//   try {
//     const status = (req.query.status as string) ;
//     const search = (req.query.search as string)?.trim();

//     const allowedStatuses = ["PENDING", "APPROVED", "REJECTED"];
//     if (!allowedStatuses.includes(status)) {
//       return sendErrorResponse(res, 400, "Invalid status");
//     }
//     /* ===============================
//        SEARCH FILTER
//     =============================== */
//     const searchFilter = search
//       ? {
//           OR: [
//             { firstName: { contains: search, mode: Prisma.QueryMode.insensitive } },
//             { lastName: { contains: search, mode: Prisma.QueryMode.insensitive } },
//             { contactEmail: { contains: search, mode: Prisma.QueryMode.insensitive } },
//             { contactPhone: { contains: search, mode: Prisma.QueryMode.insensitive } },
//           ],
//         }
//       : undefined;

//     /* ===============================
//        QUERY
//     =============================== */
//     const registrations = await prisma.registrationRequest.findMany({
//       where: {
//         status,
//         ...(searchFilter && {
//           account: { is: searchFilter },
//         }),
//       },
//       include: {
//         account: {
//           include: {
//             jobDescriptions: true,
//             user: {
//               include: {
//                 roles: {
//                   include: {
//                     role: true,
//                   },
//                 },
//               },
//             },
//           },
//         },
//       },
//       orderBy: {
//         requestedAt: "desc",
//       },
//     });

//     return sendSuccessResponse(
//       res,
//       200,
//       `${status} registrations fetched`,
//       registrations
//     );
//   } catch (error) {
//     console.error("listRegistrations error:", error);
//     return sendErrorResponse(res, 500, "Internal server error");
//   }
// }


// export async function rejectRegistration(req: Request, res: Response) {
//   const adminId = (req as any).user.id;
//   const { id } = req.params;

//   await prisma.registrationRequest.update({
//     where: { id },
//     data: {
//       status: "REJECTED",
//       decidedAt: new Date(),
//       decidedBy: adminId,
//     },
//   });

//   sendSuccessResponse(res, 200, "Registration rejected");
// }