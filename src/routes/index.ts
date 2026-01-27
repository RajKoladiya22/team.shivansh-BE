// src/routes/index.ts
import { Router } from "express";
import authRouter from "./auth";
import userRouter from "./user";
import paswordRouter from "./auth/password.route";
import jdRouter from "./jd";
import rbacRouter from "./rbac"
import adminRouter from "./admin"
import projectsRouter from "./project"
import tasksRouter from "./task"
import customersRouter from "./customer"
import notificationsRouter from "./notifications";
import templatesRouter from "./template";


const router = Router();

// base path for each module
router.use("/auth", authRouter);
router.use("/2fa", paswordRouter);
router.use("/user", userRouter);
router.use("/jd", jdRouter);
router.use("/rbac", rbacRouter);
router.use("/admin", adminRouter);
router.use("/projects", projectsRouter);
router.use("/tasks", tasksRouter);
router.use("/customers", customersRouter);
router.use("/notifications", notificationsRouter);
router.use("/templates", templatesRouter);


// export main
export default router;
