import { Router } from "express";
import { login, logout } from "../../controller/auth/auth.controller";
import { registerEmployee } from "../../controller/registration/registration.controller";

const router = Router();


router.post("/register", registerEmployee);
router.post("/login", login);
router.post("/logout", logout);
export default router;
