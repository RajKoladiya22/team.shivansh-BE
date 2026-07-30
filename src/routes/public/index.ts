import { Router } from "express";
import leadRoutes from "./lead.routes";
import quotationsRoutes from "./quotation.public.routes";
import analyticsRoutes from "./analytics.public.routes";
import tncRoutes from "./tnc.public.routes";
import portalRoutes from "./customerPortal.public.routes";

const router = Router();

router.use("/leads", leadRoutes);
router.use("/quotations", quotationsRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/tnc", tncRoutes);
router.use("/portal", portalRoutes);

export default router;