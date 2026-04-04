// src/routes/analytics/index.ts
import { Router } from "express";
import { requireAuth, requireRole } from "../../core/middleware/auth";
import {
  getOverview,
  getTrafficOverTime,
  getTopPages,
  getTrafficSources,
  getDeviceBreakdown,
  getGeoBreakdown,
  getEventReport,
  getCoreWebVitals,
  getVisitorList,
  getVisitorDetail,
  getRealtime,
  getSessionDetail,
  getRetention,
  getFunnelAnalysis,
  getDailyRollup,
} from "../../controller/admin/analytics.report.controller";

const router = Router();

// All report endpoints require an authenticated admin session
router.use(requireAuth, requireRole("ADMIN"));

/* ── Dashboard summary ─────────────────────────────────────── */

/**
 * GET /api/v1/analytics/overview?from=&to=
 * KPIs with period-over-period change:
 * sessions, pageViews, uniqueVisitors, newVisitors,
 * returningVisitors, bounceRate, avgSessionDuration, events.
 */
router.get("/overview", getOverview);

/**
 * GET /api/v1/analytics/traffic?from=&to=
 * Day-by-day time series: sessions, pageViews, uniqueVisitors.
 * Zero-filled so charts never have gaps.
 */
router.get("/traffic", getTrafficOverTime);

/**
 * GET /api/v1/analytics/rollup?from=&to=&groupBy=path|country|deviceType|referrerType|utmCampaign|utmSource
 * Fast pre-aggregated totals from AnalyticsDailyRollup.
 * Use this for all summary charts — never scans raw tables.
 */
router.get("/rollup", getDailyRollup);

/* ── Content ───────────────────────────────────────────────── */

/**
 * GET /api/v1/analytics/pages?from=&to=&page=&limit=&host=
 * Top pages ranked by views, with avg time-on-page and scroll depth.
 */
router.get("/pages", getTopPages);

/* ── Acquisition ───────────────────────────────────────────── */

/**
 * GET /api/v1/analytics/referrers?from=&to=
 * Traffic by referrer type, top referring hostnames,
 * UTM source breakdown, and campaign performance table.
 */
router.get("/referrers", getTrafficSources);

/* ── Audience ──────────────────────────────────────────────── */

/**
 * GET /api/v1/analytics/devices?from=&to=
 * Device type, browser, OS, browser version, screen size buckets.
 */
router.get("/devices", getDeviceBreakdown);

/**
 * GET /api/v1/analytics/geo?from=&to=&limit=
 * Country + city breakdown with avg lat/lng for map pins.
 */
router.get("/geo", getGeoBreakdown);

/**
 * GET /api/v1/analytics/retention?from=&to=
 * New vs returning split, session-depth histogram,
 * and daily new/returning trend for area chart.
 */
router.get("/retention", getRetention);

/* ── Behaviour ─────────────────────────────────────────────── */

/**
 * GET /api/v1/analytics/events?from=&to=&category=&name=&path=&page=&limit=
 * Top events by frequency, category breakdown, daily trend,
 * and top pages where events fire.
 */
router.get("/events", getEventReport);

/**
 * GET /api/v1/analytics/vitals?from=&to=&path=&limit=
 * Core Web Vitals (LCP, FID, CLS, FCP, TTFB) — site-wide averages
 * + worst pages + pass/fail distribution buckets.
 */
router.get("/vitals", getCoreWebVitals);

/**
 * GET /api/v1/analytics/funnel?steps=/a,/b,/c&from=&to=
 * Sequential conversion funnel.
 * Pass steps as comma-separated paths.
 * Returns per-step visitor count, drop-off %, and overall conv %.
 */
router.get("/funnel", getFunnelAnalysis);

/* ── Visitors ──────────────────────────────────────────────── */

/**
 * GET /api/v1/analytics/visitors?from=&to=&page=&limit=&country=&isReturning=&accountId=&search=
 * Paginated visitor list with latest session device/referrer snapshot.
 */
router.get("/visitors", getVisitorList);

/**
 * GET /api/v1/analytics/visitors/:visitorId
 * Full visitor profile: last 20 sessions with page journeys,
 * plus last 100 events.
 */
router.get("/visitors/:visitorId", getVisitorDetail);

/* ── Sessions ──────────────────────────────────────────────── */

/**
 * GET /api/v1/analytics/sessions/:sessionId
 * Full session detail: ordered page views + events,
 * device info, geo, UTM, duration.
 */
router.get("/sessions/:sessionId", getSessionDetail);

/* ── Realtime ──────────────────────────────────────────────── */

/**
 * GET /api/v1/analytics/realtime?window=5
 * Active sessions + page views + events in the last N minutes.
 * Poll every 30s on the dashboard. Default window = 5 min.
 */
router.get("/realtime", getRealtime);

export default router;