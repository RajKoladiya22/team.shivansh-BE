import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* ===============================
   ADMIN: CREATE / UPDATE JD
================================ */
export async function upsertJobDescription(req: Request, res: Response) {
  try {
    const adminId = (req as any).user?.id;
    const {
      accountId,
      title,
      designation,
      summary,
      responsibilitiesMust,
      responsibilitiesMay,
      responsibilitiesMustNot,
      companyRules,
      expectations,
      notes,
      visibility,
    } = req.body;

    if (!accountId || !title) {
      return sendErrorResponse(res, 400, "Missing required fields");
    }
    // const user = await prisma.user.findUnique({
    //   where: { id: accountId },
    //   select: { accountId: true },
    // });

    // if (!user) {
    //   return sendErrorResponse(res, 404, "User not found");
    // }

    const jd = await prisma.jobDescription.upsert({
      where: { accountId: accountId },
      update: {
        title,
        designation,
        summary,
        responsibilitiesMust,
        responsibilitiesMay,
        responsibilitiesMustNot,
        companyRules,
        expectations,
        notes,
        visibility,
        updatedBy: adminId,
      },
      create: {
        accountId,
        title,
        designation,
        summary,
        responsibilitiesMust,
        responsibilitiesMay,
        responsibilitiesMustNot,
        companyRules,
        expectations,
        notes,
        visibility,
        createdBy: adminId,
      },
    });

    sendSuccessResponse(res, 200, "Job Description saved", jd);
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Internal server error");
  }
}

/* ===============================
   ADMIN: DELETE JD
================================ */
export async function deleteJobDescription(req: Request, res: Response) {
  const { accountId } = req.params;

  await prisma.jobDescription.delete({ where: { accountId } });
  sendSuccessResponse(res, 200, "Job Description deleted");
}

/* ===============================
   EMPLOYEE: VIEW OWN JD
================================ */
export async function getMyJobDescription(req: Request, res: Response) {
  const userId = (req as any).user?.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      account: {
        include: { jobDescriptions: true },
      },
    },
  });

  if (!user?.account?.jobDescriptions) {
    return sendErrorResponse(res, 404, "Job Description not found");
  }

  sendSuccessResponse(
    res,
    200,
    "Job Description fetched",
    user.account.jobDescriptions
  );
}
