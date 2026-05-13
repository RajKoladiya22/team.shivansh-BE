// src/routes/expertise/index.ts
import productCatalogRoutes from "./expertise.routes";
import adminProductCatalogRoutes from "./admin.expertise.routes"

import { Router } from "express";

const router = Router();

router.use("/tdl", productCatalogRoutes);
router.use("/tdl/admin", adminProductCatalogRoutes);

export default router;