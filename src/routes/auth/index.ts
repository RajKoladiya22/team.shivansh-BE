import { Router } from "express";
import { login, logout } from "../../controller/auth/auth.controller";
import { registerEmployee } from "../../controller/registration/registration.controller";
import notifications from "./notification.routes";

const router = Router();

router.post("/register", registerEmployee);
router.post("/login", login);
router.post("/logout", logout);
router.use("/notifications", notifications);
export default router;
