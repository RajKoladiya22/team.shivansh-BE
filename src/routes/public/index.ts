import { Router } from "express";
import { createPublicLead } from "../../controller/public/lead.controller";
import rateLimit from "express-rate-limit";

const router = Router();

// Protect against spam — 10 submissions per IP per 15 minutes
const inquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many requests, please try again later" },
});

router.post("/leads", inquiryLimiter, createPublicLead);

export default router;