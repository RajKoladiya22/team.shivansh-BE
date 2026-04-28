import { Router } from "express";
import { getTncByToken, acceptTnc } from "../../controller/customer/tnc.controller";



const router = Router();

// Public (no auth): customer-facing endpoints — opened from the email link
// Mount these here or on a dedicated /tnc router (see note below)
router.get("/:token", getTncByToken);      // front-end loads T&C page
router.post("/:token/accept", acceptTnc);  // customer clicks Accept


export default router;
