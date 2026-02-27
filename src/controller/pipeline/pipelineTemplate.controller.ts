// // src/controllers/pipeline/pipelineTemplate.controller.ts

// import { Request, Response } from "express";
// import { prisma } from "../../config/database.config";
// import {
//   sendErrorResponse,
//   sendSuccessResponse,
// } from "../../core/utils/httpResponse";

// /* =========================================================
//    CREATE PIPELINE TEMPLATE
// ========================================================= */
// export async function createPipelineTemplate(req: Request, res: Response) {
//   try {
//     const { name, description, steps } = req.body;
//     const adminId = (req as any).user?.id;

//     if (!name || !Array.isArray(steps)) {
//       return sendErrorResponse(res, 400, "Name and steps are required");
//     }

//     const template = await prisma.pipelineTemplate.create({
//       data: {
//         name,
//         description,
//         createdBy: adminId,
//         steps: {
//           create: steps.map((step: any, index: number) => ({
//             name: step.name,
//             order: step.order ?? index + 1,
//             description: step.description,
//             defaultTasks: {
//               create: (step.tasks || []).map((task: any) => ({
//                 title: task.title,
//                 description: task.description,
//                 offsetDays: task.offsetDays ?? 0,
//                 defaultAssignmentStrategy: task.defaultAssignmentStrategy,
//                 defaultRoleId: task.defaultRoleId,
//               })),
//             },
//           })),
//         },
//       },
//       include: {
//         steps: {
//           include: { defaultTasks: true },
//           orderBy: { order: "asc" },
//         },
//       },
//     });

//     sendSuccessResponse(res, 201, "Pipeline template created", template);
//   } catch (error: any) {
//     console.error(error);
//     sendErrorResponse(res, 500, "Failed to create pipeline template");
//   }
// }

// /* =========================================================
//    LIST PIPELINE TEMPLATES
// ========================================================= */
// export async function getPipelineTemplates(req: Request, res: Response) {
//   try {
//     const templates = await prisma.pipelineTemplate.findMany({
//       where: { isActive: true },
//       include: {
//         steps: {
//           include: { defaultTasks: true },
//           orderBy: { order: "asc" },
//         },
//       },
//       orderBy: { createdAt: "desc" },
//     });

//     sendSuccessResponse(res, 200, "Pipeline templates fetched", templates);
//   } catch (error) {
//     console.error(error);
//     sendErrorResponse(res, 500, "Failed to fetch pipeline templates");
//   }
// }

// /* =========================================================
//    GET SINGLE TEMPLATE
// ========================================================= */
// export async function getPipelineTemplateById(
//   req: Request,
//   res: Response
// ) {
//   try {
//     const { id } = req.params;

//     const template = await prisma.pipelineTemplate.findUnique({
//       where: { id },
//       include: {
//         steps: {
//           include: { defaultTasks: true },
//           orderBy: { order: "asc" },
//         },
//       },
//     });

//     if (!template) {
//       return sendErrorResponse(res, 404, "Pipeline template not found");
//     }

//     sendSuccessResponse(res, 200, "Pipeline template fetched", template);
//   } catch (error) {
//     console.error(error);
//     sendErrorResponse(res, 500, "Failed to fetch pipeline template");
//   }
// }

// /* =========================================================
//    UPDATE PIPELINE TEMPLATE
// ========================================================= */
// export async function updatePipelineTemplate(
//   req: Request,
//   res: Response
// ) {
//   try {
//     const { id } = req.params;
//     const { name, description, isActive, steps } = req.body;

//     const existing = await prisma.pipelineTemplate.findUnique({
//       where: { id },
//     });

//     if (!existing) {
//       return sendErrorResponse(res, 404, "Pipeline template not found");
//     }

//     const updated = await prisma.$transaction(async (tx) => {
//       if (Array.isArray(steps)) {
//         await tx.pipelineTemplateStep.deleteMany({
//           where: { templateId: id },
//         });
//       }

//       return tx.pipelineTemplate.update({
//         where: { id },
//         data: {
//           ...(name && { name }),
//           ...(description && { description }),
//           ...(typeof isActive === "boolean" && { isActive }),
//           ...(steps && {
//             steps: {
//               create: steps.map((step: any, index: number) => ({
//                 name: step.name,
//                 order: step.order ?? index + 1,
//                 description: step.description,
//                 defaultTasks: {
//                   create: (step.tasks || []).map((task: any) => ({
//                     title: task.title,
//                     description: task.description,
//                     offsetDays: task.offsetDays ?? 0,
//                     defaultAssignmentStrategy:
//                       task.defaultAssignmentStrategy,
//                     defaultRoleId: task.defaultRoleId,
//                   })),
//                 },
//               })),
//             },
//           }),
//         },
//         include: {
//           steps: {
//             include: { defaultTasks: true },
//             orderBy: { order: "asc" },
//           },
//         },
//       });
//     });

//     sendSuccessResponse(res, 200, "Pipeline template updated", updated);
//   } catch (error) {
//     console.error(error);
//     sendErrorResponse(res, 500, "Failed to update pipeline template");
//   }
// }

// /* =========================================================
//    DELETE (SOFT)
// ========================================================= */
// export async function deletePipelineTemplate(
//   req: Request,
//   res: Response
// ) {
//   try {
//     const { id } = req.params;

//     const existing = await prisma.pipelineTemplate.findUnique({
//       where: { id },
//     });

//     if (!existing) {
//       return sendErrorResponse(res, 404, "Pipeline template not found");
//     }

//     await prisma.pipelineTemplate.update({
//       where: { id },
//       data: { isActive: false },
//     });

//     sendSuccessResponse(res, 200, "Pipeline template archived");
//   } catch (error) {
//     console.error(error);
//     sendErrorResponse(res, 500, "Failed to delete pipeline template");
//   }
// }
