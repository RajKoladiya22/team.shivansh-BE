import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* ======================================================
   PERMISSIONS
====================================================== */

// CREATE PERMISSION
export async function createPermission(req: Request, res: Response) {
  try {
    const { key, description } = req.body;

    if (!key) {
      return sendErrorResponse(res, 400, "Permission key is required");
    }

    const permission = await prisma.permission.create({
      data: { key, description },
    });

    return sendSuccessResponse(res, 201, "Permission created", permission);
  } catch (err: any) {
    // Unique constraint violation (permission key already exists)
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "Permission key already exists");
    }

    return sendErrorResponse(res, 500, "Failed to create permission");
  }
}


// GET ALL PERMISSIONS
export async function listPermissions(req: Request, res: Response) {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { key: "asc" },
    });

    return sendSuccessResponse(res, 200, "Permissions fetched", permissions);
  } catch (err) {
    return sendErrorResponse(res, 500, "Failed to fetch permissions");
  }
}


// DELETE PERMISSION
export async function deletePermission(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return sendErrorResponse(res, 400, "Permission id is required");
    }

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({
        where: { permissionId: id },
      }),
      prisma.permission.delete({
        where: { id },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Permission deleted");
  } catch (err: any) {
    // Record not found
    if (err.code === "P2025") {
      return sendErrorResponse(res, 404, "Permission not found");
    }

    return sendErrorResponse(res, 500, "Failed to delete permission");
  }
}



/* ======================================================
   ROLES
====================================================== */

// CREATE ROLE
export async function createRole(req: Request, res: Response) {
  try {
    const { name, description } = req.body;

    if (!name) {
      return sendErrorResponse(res, 400, "Role name is required");
    }

    const role = await prisma.role.create({
      data: { name, description },
    });

    return sendSuccessResponse(res, 201, "Role created", role);
  } catch (err: any) {
    // Unique constraint violation (role name already exists)
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "Role name already exists");
    }

    return sendErrorResponse(res, 500, "Failed to create role");
  }
}


// GET ALL ROLES
export async function listRoles(req: Request, res: Response) {
  try {
    const roles = await prisma.role.findMany({
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return sendSuccessResponse(res, 200, "Roles fetched", roles);
  } catch (err) {
    return sendErrorResponse(res, 500, "Failed to fetch roles");
  }
}


// DELETE ROLE
export async function deleteRole(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return sendErrorResponse(res, 400, "Role id is required");
    }

    await prisma.$transaction([
      // 1️⃣ remove role-permission mappings
      prisma.rolePermission.deleteMany({
        where: { roleId: id },
      }),

      // 2️⃣ remove user-role mappings
      prisma.userRole.deleteMany({
        where: { roleId: id },
      }),

      // 3️⃣ delete the role
      prisma.role.delete({
        where: { id },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Role deleted successfully");
  } catch (err: any) {
    // Record not found
    if (err.code === "P2025") {
      return sendErrorResponse(res, 404, "Role not found");
    }

    return sendErrorResponse(res, 500, "Failed to delete role");
  }
}



/* ======================================================
   ROLE ↔ PERMISSION MAPPING
====================================================== */

// ASSIGN PERMISSION TO ROLE
export async function assignPermissionToRole(
  req: Request,
  res: Response
) {
  try {
    const { roleId, permissionId } = req.body;

    if (!roleId || !permissionId) {
      return sendErrorResponse(res, 400, "roleId and permissionId required");
    }

    await prisma.rolePermission.create({
      data: { roleId, permissionId },
    });

    return sendSuccessResponse(res, 200, "Permission assigned to role");
  } catch (err: any) {
    // Duplicate assignment
    if (err.code === "P2002") {
      return sendErrorResponse(
        res,
        409,
        "Permission already assigned to this role"
      );
    }

    // FK constraint failed (invalid roleId or permissionId)
    if (err.code === "P2003") {
      return sendErrorResponse(res, 400, "Invalid roleId or permissionId");
    }

    return sendErrorResponse(
      res,
      500,
      "Failed to assign permission to role"
    );
  }
}


// REMOVE PERMISSION FROM ROLE
export async function removePermissionFromRole(
  req: Request,
  res: Response
) {
  try {
    const { roleId, permissionId } = req.body;

    if (!roleId || !permissionId) {
      return sendErrorResponse(res, 400, "roleId and permissionId required");
    }

    const result = await prisma.rolePermission.deleteMany({
      where: {
        roleId,
        permissionId,
      },
    });

    if (result.count === 0) {
      return sendErrorResponse(
        res,
        404,
        "Permission not assigned to this role"
      );
    }

    return sendSuccessResponse(res, 200, "Permission removed from role");
  } catch (err) {
    return sendErrorResponse(
      res,
      500,
      "Failed to remove permission from role"
    );
  }
}


