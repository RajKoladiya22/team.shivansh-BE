import { Router } from "express";
import leadRoutes from "./lead.routes";
import quotationsRoutes from "./quotation.public.routes";

const router = Router();


router.use("/leads", leadRoutes);
router.use("/quotations", quotationsRoutes);

export default router;