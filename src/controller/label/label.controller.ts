import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";

export async function createLabel(req: Request, res: Response) {
  try {
    const { name, color } = req.body;
    if (!name || !color) {
      return sendErrorResponse(res, 400, "Name and color are required");
    }

    const label = await prisma.label.create({
      data: {
        name: name.trim(),
        color,
        createdBy: req.user?.accountId ?? null,
      },
    });

    return sendSuccessResponse(res, 201, "Label created", label);
  } catch (err: any) {
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "Label name must be unique");
    }
    return sendErrorResponse(res, 500, err.message || "Failed to create label");
  }
}

export async function listLabels(req: Request, res: Response) {
  try {
    const { isActive } = req.query;
    const where: any = {};
    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    const labels = await prisma.label.findMany({
      where,
      orderBy: { name: "asc" },
    });

    return sendSuccessResponse(res, 200, "Labels fetched", labels);
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message || "Failed to list labels");
  }
}

export async function updateLabel(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { name, color, isActive } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (color !== undefined) updateData.color = color;
    if (isActive !== undefined) updateData.isActive = isActive;

    const label = await prisma.label.update({
      where: { id },
      data: updateData,
    });

    return sendSuccessResponse(res, 200, "Label updated", label);
  } catch (err: any) {
    if (err.code === "P2002") {
      return sendErrorResponse(res, 409, "Label name must be unique");
    }
    return sendErrorResponse(res, 500, err.message || "Failed to update label");
  }
}

export async function deleteLabel(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const usageCount = await prisma.taskLabel.count({
      where: { labelId: id },
    });

    if (usageCount > 0) {
      const label = await prisma.label.update({
        where: { id },
        data: { isActive: false },
      });
      return sendSuccessResponse(res, 200, "Label deactivated (used in tasks)", label);
    } else {
      await prisma.label.delete({
        where: { id },
      });
      return sendSuccessResponse(res, 200, "Label deleted");
    }
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message || "Failed to delete label");
  }
}
