// src/routes/expertise/index.ts
import productCatalogRoutes from "./expertise.routes";

import { Router } from "express";

const router = Router();

router.use("/tdl", productCatalogRoutes);

export default router;