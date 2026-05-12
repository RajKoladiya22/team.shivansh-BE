// src/routes/product/index.ts
import productCatalogRoutes from "./product-catalog.routes";

import { Router } from "express";

const router = Router();

router.use("/catalog", productCatalogRoutes);

export default router;