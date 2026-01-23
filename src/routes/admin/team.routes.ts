import { Router } from "express";
import { requireAuth, requireRole, requirePermission } from "../../core/middleware/auth";
import {
  createTeam,
  listTeams,
  getTeamById,
  deleteTeam,
  addMemberToTeam,
  removeMemberFromTeam,
  updateTeam,
} from "../../controller/team/team.controller";

const router = Router();

/* ================= TEAMS ================= */

router.post(
  "/teams",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  createTeam
);

router.get(
  "/teams",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  listTeams
);

router.get(
  "/teams/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getTeamById
);

router.delete(
  "/teams/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  deleteTeam
);

router.patch(
  "/teams/:teamId",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  updateTeam
);


/* ========== TEAM MEMBERS ========== */

router.post(
  "/teams/add-member",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  addMemberToTeam
);

router.post(
  "/teams/remove-member",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  removeMemberFromTeam
);

export default router;
