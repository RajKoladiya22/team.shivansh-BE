import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";

export async function setTaskCustomFieldValue(req: Request, res: Response) {
  try {
    const { id: taskId } = req.params;
    const { fieldId, value } = req.body;

    if (!fieldId) {
      return sendErrorResponse(res, 400, "fieldId is required");
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
    });
    if (!task) {
      return sendErrorResponse(res, 404, "Task not found");
    }

    const field = await prisma.projectCustomField.findUnique({
      where: { id: fieldId },
    });
    if (!field) {
      return sendErrorResponse(res, 404, "Custom field not found");
    }

    const fieldValue = await prisma.taskCustomFieldValue.upsert({
      where: { taskId_fieldId: { taskId, fieldId } },
      update: { value: value !== undefined ? String(value) : null },
      create: { taskId, fieldId, value: value !== undefined ? String(value) : null },
    });

    return sendSuccessResponse(res, 200, "Field value set", fieldValue);
  } catch (err: any) {
    console.error("[setTaskCustomFieldValue]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to set field value");
  }
}

export async function getTaskCustomFieldValues(req: Request, res: Response) {
  try {
    const { id: taskId } = req.params;

    const values = await prisma.taskCustomFieldValue.findMany({
      where: { taskId },
      include: { field: true },
    });

    return sendSuccessResponse(res, 200, "Field values fetched", values);
  } catch (err: any) {
    console.error("[getTaskCustomFieldValues]", err);
    return sendErrorResponse(res, 500, err.message || "Failed to fetch field values");
  }
}
