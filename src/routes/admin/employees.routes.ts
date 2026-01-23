import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  requireRole,
} from "../../core/middleware/auth";

import {
  listEmployees,
  getEmployeeDetails,
  updateEmployee,
  deleteEmployee,
  updateEmployeeRoles,
} from "../../controller/admin/employee.controller";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/employees", listEmployees);
router.get("/employees/:accountId", getEmployeeDetails);
router.put("/employees/:accountId", updateEmployee);
router.delete("/employees/:accountId", deleteEmployee);

router.put("/employees/:accountId/roles", updateEmployeeRoles);

export default router;
