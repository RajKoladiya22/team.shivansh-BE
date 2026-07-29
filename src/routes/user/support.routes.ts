import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { 
    createSupportUser,
    listSupportsUser,
    getSupportDetailsUser,
    updateSupportUser,
    logSupportTimeUser,
    addSupportRemarkUser, editSupportRemarkUser, deleteSupportRemarkUser,
    getSupportCountByStatusUser,
    startSupportWorkUser,
    stopSupportWorkUser,
    addSupportHelper,
    removeSupportHelper
} from "../../controller/support/support.controller";

const router = Router();

router.use(requireAuth);

router.get("/supports/my/stats/status", getSupportCountByStatusUser);
router.post("/supports/my", createSupportUser);
router.get("/supports/my", listSupportsUser);
router.get("/supports/:id", getSupportDetailsUser);
router.patch("/supports/:id/status", updateSupportUser);
router.post("/supports/:id/helpers", addSupportHelper);
router.delete("/supports/:id/helpers/:helperId", removeSupportHelper);
router.post("/supports/:id/time", logSupportTimeUser);
router.post("/supports/:id/remarks", addSupportRemarkUser);
router.put("/supports/:id/remarks/:remarkId", editSupportRemarkUser);
router.delete("/supports/:id/remarks/:remarkId", deleteSupportRemarkUser);
router.post("/supports/:id/work/start", startSupportWorkUser);
router.post("/supports/:id/work/stop", stopSupportWorkUser);

export default router;

