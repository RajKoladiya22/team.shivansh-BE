import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  getCustomerList,
  getCustomerDetails,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  addCustomerProduct,
  expireCustomerProduct,
  deleteCustomerPermanentAdmin,
  removeCustomerProductAdmin,
  bulkImportCustomers,
  verifyBulkCustomers,
  getCustomerAnalytics,
} from "../../controller/customer/customer.controller";
import multer from "multer";
import { sendTncEmail, getTncByToken, acceptTnc } from "../../controller/customer/tnc.controller";

const upload = multer({
  storage: multer.memoryStorage(), // important (buffer access)
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const router = Router();

// ─── Customer CRUD ────────────────────────────────────────────────────────────
router.get("/analytics", requireAuth, getCustomerAnalytics);
router.get("/", requireAuth, getCustomerList);
router.get("/:id", requireAuth, getCustomerDetails);
router.post("/", requireAuth, createCustomer);
router.patch("/:id", requireAuth, updateCustomer);
router.delete("/:id", requireAuth, deleteCustomer);

// ─── Products ─────────────────────────────────────────────────────────────────
router.post("/:id/products", requireAuth, addCustomerProduct);
router.patch(
  "/:id/products/:productId/expire",
  requireAuth,
  expireCustomerProduct,
);
router.delete("/:id/permanent", requireAuth, deleteCustomerPermanentAdmin);

// ─── Admin: hard delete ───────────────────────────────────────────────────────
router.delete(
  "/:customerId/products/:productId",
  requireAuth,
  removeCustomerProductAdmin,
);

// ─── Bulk import ──────────────────────────────────────────────────────────────
router.post("/bulk/verify", requireAuth, upload.single("file"), verifyBulkCustomers);
router.post("/bulk/import", requireAuth, bulkImportCustomers);


// ─── Terms & Conditions ───────────────────────────────────────────────────────
// Admin: generate token + send email to customer
router.post("/:id/send-tnc", requireAuth, sendTncEmail);


export default router;
