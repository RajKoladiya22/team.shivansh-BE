import { Router } from "express";
import { requireAuth, requireRole } from "../../core/middleware/auth";
import { 
    createSupportAdmin,
    listSupportsAdmin,
    getSupportDetailsAdmin,
    updateSupportAdmin,
    assignSupportAdmin,
    addSupportRemarkAdmin, editSupportRemarkAdmin, deleteSupportRemarkAdmin,
    getSupportCountByStatusAdmin,
    startSupportWorkAdmin,
    stopSupportWorkAdmin,
    deleteSupportAdmin,
    addSupportHelper,
    removeSupportHelper
} from "../../controller/support/support.controller";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN"));

router.post("/supports", createSupportAdmin);
router.get("/supports/stats/status", getSupportCountByStatusAdmin);
router.get("/supports", listSupportsAdmin);
router.get("/supports/:id", getSupportDetailsAdmin);
router.patch("/supports/:id", updateSupportAdmin);
router.delete("/supports/:id", deleteSupportAdmin);
router.post("/supports/:id/assign", assignSupportAdmin);
router.post("/supports/:id/helpers", addSupportHelper);
router.delete("/supports/:id/helpers/:helperId", removeSupportHelper);
router.post("/supports/:id/remarks", addSupportRemarkAdmin);
router.put("/supports/:id/remarks/:remarkId", editSupportRemarkAdmin);
router.delete("/supports/:id/remarks/:remarkId", deleteSupportRemarkAdmin);
router.post("/supports/:id/work/start", startSupportWorkAdmin);
router.post("/supports/:id/work/stop", stopSupportWorkAdmin);

export default router;


