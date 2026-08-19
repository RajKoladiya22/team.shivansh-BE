import { Router } from "express";
import {
  listOutsourceDevelopers,
  getOutsourceDeveloperById,
  createOutsourceDeveloper,
  updateOutsourceDeveloper,
  deleteOutsourceDeveloper,
} from "../../controller/outsourceDeveloper/outsourceDeveloper.controller";
import { requireAuth } from "../../core/middleware/auth";

const router = Router();

router.use(requireAuth);

router.get("/", listOutsourceDevelopers);
router.post("/", createOutsourceDeveloper);
router.get("/:id", getOutsourceDeveloperById);
router.patch("/:id", updateOutsourceDeveloper);
router.delete("/:id", deleteOutsourceDeveloper);

export default router;
