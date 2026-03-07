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
  removeCustomerProductAdmin
} from "../../controller/customer/customer.controller";

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

export default router;
