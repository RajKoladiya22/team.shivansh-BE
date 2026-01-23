import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { upsertMyBank, getMyBank } from "../../controller/user/bank.controller";
import { getMySalaryNotices, getSalaryStatement } from "../../controller/admin/salary.admin.controller";

const router = Router();

router.get("/my", requireAuth, getMyBank);
router.post("/my", requireAuth, upsertMyBank);
router.put("/my", requireAuth, upsertMyBank);
router.get("/statement", requireAuth, getSalaryStatement);
router.get("/notices/my", requireAuth, getMySalaryNotices);


export default router;
