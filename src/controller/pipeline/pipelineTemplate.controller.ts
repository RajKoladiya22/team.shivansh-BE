import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* =========================================================
   CREATE PIPELINE TEMPLATE
========================================================= */
export async function createPipelineTemplate(req: Request, res: Response) {
  try {
    const { name, description, steps } = req.body;
    const adminAccountId = req.user?.accountId;

    if (!name || !Array.isArray(steps)) {
      return sendErrorResponse(res, 400, "Name and steps are required");
    }

    const template = await prisma.pipelineTemplate.create({
      data: {
        name: name.trim(),
        description,
        createdBy: adminAccountId || null,
        steps: {
          create: steps.map((step: any, index: number) => ({
            name: step.name,
            order: step.order ?? index + 1,
            description: step.description,
            defaultTasks: {
              create: (step.tasks || []).map((task: any) => ({
                title: task.title,
                description: task.description,
                offsetDays: task.offsetDays ?? 0,
                defaultAssignmentStrategy: task.defaultAssignmentStrategy,
                defaultRoleId: task.defaultRoleId,
              })),
            },
          })),
        },
      },
      include: {
        steps: {
          include: { defaultTasks: true },
          orderBy: { order: "asc" },
        },
      },
    });

    return sendSuccessResponse(res, 201, "Pipeline template created", template);
  } catch (error: any) {
    if (error.code === "P2002") {
      return sendErrorResponse(res, 409, "Template name must be unique");
    }
    console.error(error);
    return sendErrorResponse(res, 500, "Failed to create pipeline template");
  }
}

/* =========================================================
   LIST PIPELINE TEMPLATES
========================================================= */
export async function getPipelineTemplates(req: Request, res: Response) {
  try {
    const templates = await prisma.pipelineTemplate.findMany({
      where: { isActive: true },
      include: {
        steps: {
          include: { defaultTasks: true },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccessResponse(res, 200, "Pipeline templates fetched", templates);
  } catch (error) {
    console.error(error);
    return sendErrorResponse(res, 500, "Failed to fetch pipeline templates");
  }
}

/* =========================================================
   GET SINGLE TEMPLATE
========================================================= */
export async function getPipelineTemplateById(
  req: Request,
  res: Response
) {
  try {
    const { id } = req.params;

    const template = await prisma.pipelineTemplate.findUnique({
      where: { id },
      include: {
        steps: {
          include: { defaultTasks: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!template) {
      return sendErrorResponse(res, 404, "Pipeline template not found");
    }

    return sendSuccessResponse(res, 200, "Pipeline template fetched", template);
  } catch (error) {
    console.error(error);
    return sendErrorResponse(res, 500, "Failed to fetch pipeline template");
  }
}

/* =========================================================
   UPDATE PIPELINE TEMPLATE
========================================================= */
export async function updatePipelineTemplate(
  req: Request,
  res: Response
) {
  try {
    const { id } = req.params;
    const { name, description, isActive, steps } = req.body;

    const existing = await prisma.pipelineTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      return sendErrorResponse(res, 404, "Pipeline template not found");
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (Array.isArray(steps)) {
        await tx.pipelineTemplateStep.deleteMany({
          where: { templateId: id },
        });
      }

      return tx.pipelineTemplate.update({
        where: { id },
        data: {
          name: name !== undefined ? name.trim() : undefined,
          description: description !== undefined ? description : undefined,
          isActive: typeof isActive === "boolean" ? isActive : undefined,
          steps: steps ? {
            create: steps.map((step: any, index: number) => ({
              name: step.name,
              order: step.order ?? index + 1,
              description: step.description,
              defaultTasks: {
                create: (step.tasks || []).map((task: any) => ({
                  title: task.title,
                  description: task.description,
                  offsetDays: task.offsetDays ?? 0,
                  defaultAssignmentStrategy:
                    task.defaultAssignmentStrategy,
                  defaultRoleId: task.defaultRoleId,
                })),
              },
            })),
          } : undefined,
        },
        include: {
          steps: {
            include: { defaultTasks: true },
            orderBy: { order: "asc" },
          },
        },
      });
    });

    return sendSuccessResponse(res, 200, "Pipeline template updated", updated);
  } catch (error: any) {
    if (error.code === "P2002") {
      return sendErrorResponse(res, 409, "Template name must be unique");
    }
    console.error(error);
    return sendErrorResponse(res, 500, "Failed to update pipeline template");
  }
}

/* =========================================================
   DELETE (SOFT)
========================================================= */
export async function deletePipelineTemplate(
  req: Request,
  res: Response
) {
  try {
    const { id } = req.params;

    const existing = await prisma.pipelineTemplate.findUnique({
      where: { id },
    });

    if (!existing) {
      return sendErrorResponse(res, 404, "Pipeline template not found");
    }

    await prisma.pipelineTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    return sendSuccessResponse(res, 200, "Pipeline template archived");
  } catch (error) {
    console.error(error);
    return sendErrorResponse(res, 500, "Failed to delete pipeline template");
  }
}
