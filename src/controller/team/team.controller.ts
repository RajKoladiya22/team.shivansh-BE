// src/controller/team/team.controller.ts

import { Request, Response } from "express";
import {
  sendSuccessResponse,
  sendErrorResponse,
} from "../../core/utils/httpResponse";
import { prisma } from "../../config/database.config";

export async function createTeam(req: Request, res: Response) {
  try {
    const { name, description } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return sendErrorResponse(res, 401, "Please login again");
    }

    if (!name) {
      return sendErrorResponse(res, 400, "Team name is required");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountId: true },
    });

    if (!user) {
      return sendErrorResponse(res, 401, "Invalid session user");
    }

    const team = await prisma.$transaction(async (tx) => {
      // 1️⃣ Create team
      const team = await tx.team.create({
        data: {
          name,
          description,
          createdBy: user.accountId,
        },
      });

      // 2️⃣ Add creator as LEAD
      await tx.teamMember.create({
        data: {
          teamId: team.id,
          accountId: user.accountId,
          role: "LEAD",
        },
      });

      return team;
    });

    return sendSuccessResponse(
      res,
      201,
      "Team created and creator added as LEAD",
      team
    );
  } catch (err: any) {
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "Team name already exists");
    }

    return sendErrorResponse(res, 500, "Failed to create team");
  }
}

export async function listTeams(req: Request, res: Response) {
  try {
    const { search, isActive } = req.query;

    /**
     * Default behavior:
     * - isActive = true
     * - search optional
     */
    const where: any = {
      isActive:
        isActive === undefined
          ? true
          : String(isActive).toLowerCase() === "true",
    };

    if (search && String(search).trim() !== "") {
      where.name = {
        contains: String(search).trim(),
        mode: "insensitive",
      };
    }

    const teams = await prisma.team.findMany({
      where,
      include: {
        members: {
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                contactEmail: true,
                designation: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccessResponse(res, 200, "Teams fetched", teams);
  } catch (err) {
    return sendErrorResponse(res, 500, "Failed to fetch teams");
  }
}

export async function getTeamById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            account: true,
          },
        },
      },
    });

    if (!team) {
      return sendErrorResponse(res, 404, "Team not found");
    }

    return sendSuccessResponse(res, 200, "Team fetched", team);
  } catch {
    return sendErrorResponse(res, 500, "Failed to fetch team");
  }
}

export async function addMemberToTeam(req: Request, res: Response) {
  try {
    const { teamId, accountId, accountIds, role } = req.body;

    if (!teamId) {
      return sendErrorResponse(res, 400, "teamId is required");
    }

    // Normalize to array
    const ids: string[] = accountIds
      ? Array.isArray(accountIds)
        ? accountIds
        : []
      : accountId
      ? [accountId]
      : [];

    if (ids.length === 0) {
      return sendErrorResponse(
        res,
        400,
        "accountId or accountIds is required"
      );
    }

    const data = ids.map((id) => ({
      teamId,
      accountId: id,
      role,
    }));

    const result = await prisma.teamMember.createMany({
      data,
      skipDuplicates: true, // 🔥 prevents P2002
    });

    return sendSuccessResponse(res, 200, "Members added to team", {
      addedCount: result.count,
      requestedCount: ids.length,
    });
  } catch (err: any) {
    if (err.code === "P2003") {
      return sendErrorResponse(res, 400, "Invalid team or account");
    }

    return sendErrorResponse(res, 500, "Failed to add member(s)");
  }
}


export async function removeMemberFromTeam(req: Request, res: Response) {
  try {
    const { teamId, accountId } = req.body;

    if (!teamId || !accountId) {
      return sendErrorResponse(res, 400, "teamId and accountId required");
    }

    const result = await prisma.teamMember.deleteMany({
      where: { teamId, accountId },
    });

    if (result.count === 0) {
      return sendErrorResponse(res, 404, "Member not found in team");
    }

    return sendSuccessResponse(res, 200, "Member removed from team");
  } catch {
    return sendErrorResponse(res, 500, "Failed to remove member");
  }
}

export async function deleteTeam(req: Request, res: Response) {
  try {
    const { id } = req.params;

    await prisma.team.delete({
      where: { id },
    });

    return sendSuccessResponse(res, 200, "Team deleted");
  } catch (err: any) {
    if (err.code === "P2025") {
      return sendErrorResponse(res, 404, "Team not found");
    }
    return sendErrorResponse(res, 500, "Failed to delete team");
  }
}

export async function updateTeam(req: Request, res: Response) {
  try {
    const { teamId } = req.params;
    const { name, description, isActive } = req.body;

    if (!teamId) {
      return sendErrorResponse(res, 400, "teamId is required");
    }

    // Build update payload safely
    const data: any = {};

    if (name !== undefined) {
      if (!String(name).trim()) {
        return sendErrorResponse(res, 400, "Team name cannot be empty");
      }
      data.name = String(name).trim();
    }

    if (description !== undefined) {
      data.description = String(description).trim();
    }

    if (isActive !== undefined) {
      data.isActive = Boolean(isActive);
    }

    if (Object.keys(data).length === 0) {
      return sendErrorResponse(res, 400, "No fields provided to update");
    }

    const team = await prisma.team.update({
      where: { id: teamId },
      data,
    });

    return sendSuccessResponse(res, 200, "Team updated successfully", team);
  } catch (err: any) {
    // Team not found
    if (err.code === "P2025") {
      return sendErrorResponse(res, 404, "Team not found");
    }

    // Unique constraint (duplicate name)
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "Team name already exists");
    }

    return sendErrorResponse(res, 500, "Failed to update team");
  }
}
