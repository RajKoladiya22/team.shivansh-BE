// src/routes/index.ts
import { Router } from "express";
import authRouter from "./auth";
import userRouter from "./user";
import paswordRouter from "./auth/password.route";
import jdRouter from "./jd";
import rbacRouter from "./rbac"
import adminRouter from "./admin"
import customersRouter from "./customer"
import notificationsRouter from "./notifications";
import templatesRouter from "./template";
import dsuRouter from "./dsu";
import commonRouter from "./common"
import publicRouter from "./public"
import tasksRouter from "./task"
// import projectsRouter from "./project"


const router = Router();

// base path for each module
router.use("/auth", authRouter);
router.use("/2fa", paswordRouter);
router.use("/user", userRouter);
router.use("/admin", adminRouter);
router.use("/jd", jdRouter);
router.use("/rbac", rbacRouter);
router.use("/customers", customersRouter);
router.use("/notifications", notificationsRouter);
router.use("/templates", templatesRouter);
router.use("/common", commonRouter);
router.use("/dsu", dsuRouter);
router.use("/public", publicRouter);
router.use("/tasks", tasksRouter);
// router.use("/projects", projectsRouter);


// export main
export default router;
