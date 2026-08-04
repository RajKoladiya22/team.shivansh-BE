import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
import { getCallerProjectRole } from "./project.controller";
import { logProjectActivity } from "./projectActivity.helper";

export async function createProjectCustomField(req: Request, res: Response) {
  try {
    const { id: projectId } = req.params;
    const { name, fieldType, options, order, required, isActive } = req.body;
    const user = (req as any).user;

    const { isFullAccess, callerAccountId } = await getCallerProjectRole(projectId, user);
    if (!isFullAccess) {
      return sendErrorResponse(res, 403, "Only project Owners, Managers, or Admins can create custom fields");
    }

    if (!name || !fieldType) {
      return sendErrorResponse(res, 400, "Name and fieldType are required");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) {
      return sendErrorResponse(res, 404, "Project not found");
    }

    const field = await prisma.projectCustomField.create({
      data: {
        projectId,
        name: name.trim(),
        fieldType,
        options: options || null,
        order: order !== undefined ? Number(order) : 0,
        required: required ?? false,
        isActive: isActive ?? true,
      },
    });

    await logProjectActivity({
      projectId,
      entityType: "PROJECT",
      entityId: field.id,
      action: "CREATED",
      performedBy: callerAccountId || user?.id,
      meta: {
        fieldId: field.id,
        fieldName: field.name,
        fieldType: field.fieldType,
        message: `Created custom field "${field.name}" (${field.fieldType})`,
      },
    });

    return sendSuccessResponse(res, 201, "Custom field created", field);
  } catch (err: any) {
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "A custom field with this name already exists in this project");
    }
    console.error("[createProjectCustomField]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to create custom field");
  }
}

export async function listProjectCustomFields(req: Request, res: Response) {
  try {
    const { id: projectId } = req.params;

    const fields = await prisma.projectCustomField.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
    });

    return sendSuccessResponse(res, 200, "Custom fields fetched", fields);
  } catch (err: any) {
    console.error("[listProjectCustomFields]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to list custom fields");
  }
}

export async function updateProjectCustomField(req: Request, res: Response) {
  try {
    const { id: projectId, fieldId } = req.params;
    const { name, fieldType, options, order, required, isActive } = req.body;
    const user = (req as any).user;

    const { isFullAccess, callerAccountId } = await getCallerProjectRole(projectId, user);
    if (!isFullAccess) {
      return sendErrorResponse(res, 403, "Only project Owners, Managers, or Admins can update custom fields");
    }

    const existing = await prisma.projectCustomField.findFirst({
      where: { id: fieldId, projectId },
    });
    if (!existing) {
      return sendErrorResponse(res, 404, "Custom field not found");
    }

    const updated = await prisma.projectCustomField.update({
      where: { id: fieldId },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        fieldType: fieldType !== undefined ? fieldType : undefined,
        options: options !== undefined ? options : undefined,
        order: order !== undefined ? Number(order) : undefined,
        required: required !== undefined ? required : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
      },
    });

    await logProjectActivity({
      projectId,
      entityType: "PROJECT",
      entityId: fieldId,
      action: "UPDATED",
      performedBy: callerAccountId || user?.id,
      meta: {
        fieldId,
        fieldName: updated.name,
        message: `Updated custom field "${updated.name}"`,
      },
    });

    return sendSuccessResponse(res, 200, "Custom field updated", updated);
  } catch (err: any) {
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "A custom field with this name already exists in this project");
    }
    console.error("[updateProjectCustomField]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to update custom field");
  }
}

export async function deleteProjectCustomField(req: Request, res: Response) {
  try {
    const { id: projectId, fieldId } = req.params;
    const user = (req as any).user;

    const { isFullAccess, callerAccountId } = await getCallerProjectRole(projectId, user);
    if (!isFullAccess) {
      return sendErrorResponse(res, 403, "Only project Owners, Managers, or Admins can delete custom fields");
    }

    const existing = await prisma.projectCustomField.findFirst({
      where: { id: fieldId, projectId },
    });
    if (!existing) {
      return sendErrorResponse(res, 404, "Custom field not found");
    }

    await prisma.projectCustomField.delete({
      where: { id: fieldId },
    });

    await logProjectActivity({
      projectId,
      entityType: "PROJECT",
      entityId: fieldId,
      action: "DELETED",
      performedBy: callerAccountId || user?.id,
      meta: {
        fieldId,
        fieldName: existing.name,
        message: `Deleted custom field "${existing.name}"`,
      },
    });

    return sendSuccessResponse(res, 200, "Custom field deleted");
  } catch (err: any) {
    console.error("[deleteProjectCustomField]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to delete custom field");
  }
}

