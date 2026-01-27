// src/routes/index.ts
import { Router } from "express";

const router = Router();
import messageRouter from "./message.routes";

// base path for each module
router.use("/", messageRouter);

// export main
export default router;
