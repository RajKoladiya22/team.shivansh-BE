import { Router } from "express";
import {
    setUserExpertise,
    getMyExpertise,
    getProductExperts,
    getTeamSkillMatrix,
    removeExpertise,
} from "../../controller/expertise/expertise.controller";
import { requireAuth } from "../../core/middleware/auth";

const router = Router();

router.use(requireAuth);

// ─────────────────────────────────────
// USER EXPERTISE ENDPOINTS
// ─────────────────────────────────────

// POST /expertise/tdl
// Set or update user's expertise for a product
router.post("/", setUserExpertise);

// GET /expertise/tdl/me
// Get all products current user marked expertise for
router.get("/me", getMyExpertise);

// GET /expertise/tdl/product/:productId
// Get all users who marked expertise for this product
router.get("/product/:productId", getProductExperts);

// GET /expertise/tdl/team/:teamId/matrix
// Get skill matrix for a team (who knows what)
router.get("/team/:teamId/matrix", getTeamSkillMatrix);


// DELETE /expertise/tdl/:id
// Remove expertise record
router.delete("/:id", removeExpertise);

export default router;