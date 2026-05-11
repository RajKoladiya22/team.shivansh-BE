import { Router } from "express";
import {
    getProductCatalogList,
    getProductCatalogById,
    getProductCatalogSyncLogs,
    getProductSyncLogs,
} from "../../controller/product/product-catalog.controller";
import {
  requireAuth,
} from "../../core/middleware/auth";


const router = Router();

router.use(requireAuth);

// GET /api/product-catalog
router.get("/", getProductCatalogList);

// GET /api/product-catalog/sync-logs
router.get("/sync-logs", getProductCatalogSyncLogs);

// GET /api/product-catalog/:id
router.get("/:id", getProductCatalogById);

// GET /api/product-catalog/:id/sync-logs
router.get("/:id/sync-logs", getProductSyncLogs);

export default router;