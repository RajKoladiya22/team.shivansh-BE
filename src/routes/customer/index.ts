import { Router } from "express";
import {
  requireAuth,
  requireRole,
} from "../../core/middleware/auth";
import {
  getCustomerListAdmin,
  getCustomerDetailsAdmin,
} from "../../controller/customer/customer.controller";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  getCustomerListAdmin,
);
router.get("/:id", requireAuth, getCustomerDetailsAdmin);

export default router;
