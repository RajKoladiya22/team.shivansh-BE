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
} from "../../controller/customer/customer.controller";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(), // important (buffer access)
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const router = Router();

router.get("/", requireAuth, getCustomerList);
router.get("/:id", requireAuth, getCustomerDetails);
router.post("/", requireAuth, createCustomer);
router.patch("/:id", requireAuth, updateCustomer);
router.delete("/:id", requireAuth, deleteCustomer);
router.post("/:id/products", requireAuth, addCustomerProduct);
router.patch(
  "/:id/products/:productId/expire",
  requireAuth,
  expireCustomerProduct,
);
router.delete("/:id/permanent", requireAuth, deleteCustomerPermanentAdmin);
router.delete(
  "/:customerId/products/:productId",
  requireAuth,
  removeCustomerProductAdmin,
);
router.post("/bulk/verify", requireAuth, upload.single("file"), verifyBulkCustomers);
router.post("/bulk/import", requireAuth, bulkImportCustomers);

export default router;
