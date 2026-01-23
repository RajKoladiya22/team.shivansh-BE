// src/routes/project/project.routes.ts

import { Router } from "express";
import { createProject, getProjects, getProjectById } from "../../controller/project/project.controller";
import { requireAuth } from "../../core/middleware/auth";

const router = Router();

router.post("/", requireAuth, createProject);
router.get("/", requireAuth, getProjects);
router.get("/:id", requireAuth, getProjectById);

export default router;