// import { Router } from "express";
// import { requireAuth, requirePermission, requireRole } from "../../core/middleware/auth";
// import {createPipelineTemplate, listPipelineTemplates} from "../../controller/pipeline/pipelineTemplate.controller"


// const router = Router();
// router.post(
//   "/templates",
//   requireAuth,
//   requireRole("ADMIN"),
//   requirePermission("ALL"), createPipelineTemplate
// );

// router.get(
//   "/templates",
//   requireAuth,
//   requireRole("ADMIN"),
//   requirePermission("ALL"),
//   listPipelineTemplates
// );


// export default router;


// src/routes/admin/pipelineTemplate.routes.ts

// import { Router } from "express";
// import {
//   createPipelineTemplate,
//   getPipelineTemplates,
//   getPipelineTemplateById,
//   updatePipelineTemplate,
//   deletePipelineTemplate,
// } from "../../controller/pipeline/pipelineTemplate.controller"
// import { requireAuth, requireRole } from "../../core/middleware/auth";

// const router = Router();

// router.use(requireAuth, requireRole("ADMIN"));

// router.post("/", createPipelineTemplate);
// router.get("/", getPipelineTemplates);
// router.get("/:id", getPipelineTemplateById);
// router.put("/:id", updatePipelineTemplate);
// router.delete("/:id", deletePipelineTemplate);

// export default router;
