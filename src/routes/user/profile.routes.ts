import { Router } from "express";
import { getProfile, updateMyBusyStatus, updateProfile } from "../../controller/user/user.controller";
import { requireAuth } from "../../core/middleware/auth";
import upload from "../../core/middleware/multer"; 


const router = Router();

router.get("/profile", requireAuth, getProfile);

router.put(
  "/profile",
  requireAuth,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "aadhar", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "driving_license", maxCount: 1 },
    { name: "policy", maxCount: 1 },
  ]),
  updateProfile
);

router.patch(
  "/account/busy",
  requireAuth,
  updateMyBusyStatus
);



export default router;
