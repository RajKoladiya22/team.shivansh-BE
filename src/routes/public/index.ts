import { Router } from "express";
import leadRoutes from "./lead.routes";
import quotationsRoutes from "./quotation.public.routes";

const router = Router();


router.post("/leads", leadRoutes);
router.post("/quotations", quotationsRoutes);

export default router;