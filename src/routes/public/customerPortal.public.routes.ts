// src/routes/public/customerPortal.public.routes.ts

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { verifyCustomerPortalToken } from "../../core/middleware/auth/customerPortalAuth";
import {
  getPortalSession,
  getPortalProfile,
  updatePortalProfile,
  getPortalProducts,
  getPortalQuotations,
  getPortalQuotationById,
  acceptPortalQuotation,
  rejectPortalQuotation,
  getPortalSupports,
  getPortalSupportById,
  createPortalSupport,
  addPortalSupportRemark,
  getPortalLeads,
  createPortalLead,
  getPortalNotifications,
} from "../../controller/public/customerPortal.controller";

const router = Router();

// Rate limiting for public portal routes
const portalReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: "Too many requests. Please try again later." },
});

const portalWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: "Action rate limit exceeded. Please wait a few minutes." },
});

// All routes require valid Customer Portal Token
router.use(verifyCustomerPortalToken);

// Session & Profile
router.get("/session", portalReadLimiter, getPortalSession);
router.get("/profile", portalReadLimiter, getPortalProfile);
router.patch("/profile", portalWriteLimiter, updatePortalProfile);

// Purchased Products
router.get("/products", portalReadLimiter, getPortalProducts);

// Quotations
router.get("/quotations", portalReadLimiter, getPortalQuotations);
router.get("/quotations/:id", portalReadLimiter, getPortalQuotationById);
router.post("/quotations/:id/accept", portalWriteLimiter, acceptPortalQuotation);
router.post("/quotations/:id/reject", portalWriteLimiter, rejectPortalQuotation);

// Support Requests & History
router.get("/supports", portalReadLimiter, getPortalSupports);
router.get("/supports/:id", portalReadLimiter, getPortalSupportById);
router.post("/supports", portalWriteLimiter, createPortalSupport);
router.post("/supports/:id/remarks", portalWriteLimiter, addPortalSupportRemark);

// Lead / Inquiry History & New Inquiries
router.get("/leads", portalReadLimiter, getPortalLeads);
router.post("/leads", portalWriteLimiter, createPortalLead);

// Notifications & Updates
router.get("/notifications", portalReadLimiter, getPortalNotifications);

export default router;
