// src/controller/common/team.controller.ts

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";


/**
 * GET /common/teams
 * - Lists all teams
 * - Own teams appear first
 * - Adds isMyTeam flag
 */
export async function listCommonTeams(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    // resolve accountId from user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountId: true },
    });

    if (!user?.accountId) {
      return sendErrorResponse(res, 400, "Invalid account");
    }

    const accountId = user.accountId;

    const teams = await prisma.team.findMany({
      where: { isActive: true },
      include: {
        members: {
          where: { isActive: true },
          select: {
            accountId: true,
            role: true,
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // decorate + sort
    const mapped = teams
      .map((team) => {
        const myMembership = team.members.find(
          (m) => m.accountId === accountId,
        );

        return {
          id: team.id,
          name: team.name,
          description: team.description,
          isActive: team.isActive,
          createdAt: team.createdAt,

          // 🔥 flags
          isMyTeam: Boolean(myMembership),
          myRole: myMembership?.role ?? null,

          memberCount: team.members.length,
          members: team.members.map((m) => ({
            id: m.account.id,
            name: `${m.account.firstName} ${m.account.lastName}`,
            designation: m.account.designation,
            role: m.role,
          })),
        };
      })
      // 🔥 own teams first
      .sort((a, b) => Number(b.isMyTeam) - Number(a.isMyTeam));

    return sendSuccessResponse(res, 200, "Teams fetched", mapped);
  } catch (err: any) {
    console.error("listCommonTeams error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch teams");
  }
}



/**
 * GET /common/teams/:id
 * - Team details
 * - Includes members
 * - Marks if user belongs to this team
 */
export async function getCommonTeamById(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountId: true },
    });

    if (!user?.accountId) {
      return sendErrorResponse(res, 400, "Invalid account");
    }

    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          where: { isActive: true },
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                contactEmail: true,
                contactPhone: true,
              },
            },
          },
        },
      },
    });

    if (!team) {
      return sendErrorResponse(res, 404, "Team not found");
    }

    const myMembership = team.members.find(
      (m) => m.accountId === user.accountId,
    );

    const response = {
      id: team.id,
      name: team.name,
      description: team.description,
      isActive: team.isActive,
      createdAt: team.createdAt,

      isMyTeam: Boolean(myMembership),
      myRole: myMembership?.role ?? null,

      members: team.members.map((m) => ({
        id: m.account.id,
        name: `${m.account.firstName} ${m.account.lastName}`,
        designation: m.account.designation,
        email: m.account.contactEmail,
        contactPhone: m.account.contactPhone,
        role: m.role,
      })),
    };

    return sendSuccessResponse(res, 200, "Team fetched", response);
  } catch (err: any) {
    console.error("getCommonTeamById error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch team");
  }
}
