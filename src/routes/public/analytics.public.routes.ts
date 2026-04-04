import { Router } from "express";
import {
  trackSessionStart,
  trackPageView,
  trackEvent,
  trackSessionEnd,
  trackBatch,
} from "../../controller/public/analytics.public.controller";



const router = Router();

/**
 * POST /api/v1/public/analytics/session/start
 */
router.post("/session/start", trackSessionStart);

/**
 * POST /api/v1/public/analytics/pageview
 */
router.post("/pageview", trackPageView);

/**
 * POST /api/v1/public/analytics/event
 */
router.post("/event", trackEvent);

/**
 * POST /api/v1/public/analytics/session/end
 */
router.post("/session/end", trackSessionEnd);

/**
 * POST /api/v1/public/analytics/batch
 * (recommended for production)
 */
router.post("/batch", trackBatch);

export default router;