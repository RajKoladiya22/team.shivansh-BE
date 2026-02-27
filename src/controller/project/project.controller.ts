// // src/controllers/project/project.controller.ts

// import { Request, Response } from "express";
// import { prisma } from "../../config/database.config";
// import {
//   sendErrorResponse,
//   sendSuccessResponse,
// } from "../../core/utils/httpResponse";

// /* =========================================================
//    CREATE PROJECT (TEMPLATE OR FRESH)
// ========================================================= */
// export async function createProject(req: Request, res: Response) {
//   try {
//     const user = (req as any).user;
//     const {
//       name,
//       description,
//       startDate,
//       templateId,
//       pipeline,
//     } = req.body;

//     if (!name) {
//       return sendErrorResponse(res, 400, "Project name is required");
//     }

//     if (!templateId && !pipeline) {
//       return sendErrorResponse(
//         res,
//         400,
//         "Either templateId or pipeline definition is required"
//       );
//     }

//     const project = await prisma.$transaction(async (tx) => {
//       /* ---------------- CREATE PROJECT ---------------- */
//       const project = await tx.project.create({
//         data: {
//           name,
//           description,
//           startDate: startDate ? new Date(startDate) : undefined,
//           createdBy: user.id,
//         },
//       });

//       /* =================================================
//          MODE A — CREATE PIPELINE FROM TEMPLATE
//       ================================================= */
//       if (templateId) {
//         const template = await tx.pipelineTemplate.findUnique({
//           where: { id: templateId },
//           include: {
//             steps: {
//               include: { defaultTasks: true },
//               orderBy: { order: "asc" },
//             },
//           },
//         });

//         if (!template) {
//           throw new Error("Pipeline template not found");
//         }

//         const pipeline = await tx.projectPipeline.create({
//           data: {
//             projectId: project.id,
//             source: "TEMPLATE",
//             sourceTemplateId: template.id,
//           },
//         });

//         for (const step of template.steps) {
//           const pipelineStep = await tx.pipelineStep.create({
//             data: {
//               pipelineId: pipeline.id,
//               name: step.name,
//               order: step.order,
//               templateStepId: step.id,
//             },
//           });

//           for (const task of step.defaultTasks) {
//             await tx.task.create({
//               data: {
//                 projectId: project.id,
//                 stepId: pipelineStep.id,
//                 title: task.title,
//                 description: task.description,
//                 templateTaskId: task.id,
//                 dueDate:
//                   startDate && task.offsetDays !== null
//                     ? new Date(
//                         new Date(startDate).getTime() +
//                           task.offsetDays * 86400000
//                       )
//                     : undefined,
//                 createdBy: user.id,
//               },
//             });
//           }
//         }
//       }

//       /* =================================================
//          MODE B — CREATE FRESH PIPELINE
//       ================================================= */
//       if (pipeline) {
//         const projectPipeline = await tx.projectPipeline.create({
//           data: {
//             projectId: project.id,
//             source: "CUSTOM",
//           },
//         });

//         for (const step of pipeline.steps || []) {
//           const pipelineStep = await tx.pipelineStep.create({
//             data: {
//               pipelineId: projectPipeline.id,
//               name: step.name,
//               order: step.order,
//             },
//           });

//           for (const task of step.tasks || []) {
//             await tx.task.create({
//               data: {
//                 projectId: project.id,
//                 stepId: pipelineStep.id,
//                 title: task.title,
//                 description: task.description,
//                 createdBy: user.id,
//               },
//             });
//           }
//         }
//       }

//       return project;
//     });

//     sendSuccessResponse(res, 201, "Project created successfully", project);
//   } catch (error: any) {
//     console.error(error);
//     sendErrorResponse(
//       res,
//       500,
//       error.message || "Failed to create project"
//     );
//   }
// }


// /* =========================================================
//    GET PROJECT LIST
// ========================================================= */
// export async function getProjects(req: Request, res: Response) {
//   try {
//     const user = (req as any).user;

//     const {
//       page = 1,
//       limit = 10,
//       status,
//       search,
//       includePipeline,
//     } = req.query;

//     const skip = (Number(page) - 1) * Number(limit);

//     const where: any = {
//       ...(status && { status }),
//       ...(search && {
//         name: { contains: String(search), mode: "insensitive" },
//       }),
//     };

//     const [projects, total] = await Promise.all([
//       prisma.project.findMany({
//         where,
//         skip,
//         take: Number(limit),
//         orderBy: { createdAt: "desc" },
//         include: {
//           pipeline: includePipeline === "true"
//             ? {
//                 include: {
//                   steps: {
//                     orderBy: { order: "asc" },
//                     include: {
//                       tasks: {
//                         include: {
//                           assignments: true,
//                         },
//                         orderBy: { createdAt: "asc" },
//                       },
//                     },
//                   },
//                 },
//               }
//             : false,
//         },
//       }),
//       prisma.project.count({ where }),
//     ]);

//     sendSuccessResponse(res, 200, "Projects fetched", {
//       data: projects,
//       meta: {
//         page: Number(page),
//         limit: Number(limit),
//         total,
//         totalPages: Math.ceil(total / Number(limit)),
//       },
//     });
//   } catch (error) {
//     console.error(error);
//     sendErrorResponse(res, 500, "Failed to fetch projects");
//   }
// }

// /* =========================================================
//    GET PROJECT BY ID
// ========================================================= */
// export async function getProjectById(req: Request, res: Response) {
//   try {
//     const { id } = req.params;

//     const project = await prisma.project.findUnique({
//       where: { id },
//       include: {
//         pipeline: {
//           include: {
//             steps: {
//               orderBy: { order: "asc" },
//               include: {
//                 tasks: {
//                   orderBy: { createdAt: "asc" },
//                   include: {
//                     assignments: {
//                       include: {
//                         account: true,
//                         team: true,
//                       },
//                     },
//                     subTasks: true,
//                   },
//                 },
//               },
//             },
//           },
//         },
//         activity: {
//           orderBy: { createdAt: "desc" },
//           take: 100,
//         },
//       },
//     });

//     if (!project) {
//       return sendErrorResponse(res, 404, "Project not found");
//     }

//     sendSuccessResponse(res, 200, "Project fetched", project);
//   } catch (error) {
//     console.error(error);
//     sendErrorResponse(res, 500, "Failed to fetch project");
//   }
// }
