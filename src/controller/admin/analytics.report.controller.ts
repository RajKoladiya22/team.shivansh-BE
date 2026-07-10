// src/controller/admin/analytics.report.controller.ts
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";


/* ═══════════════════════════════════════════════════════════
   IP EXTRACTION
   Works behind Nginx / Caddy / cloud load balancers.
   Priority: X-Forwarded-For (first IP) → X-Real-IP → req.ip
═══════════════════════════════════════════════════════════ */

export function extractClientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      .split(",")[0]
      .trim();
    if (first && first !== "::1" && first !== "127.0.0.1") return first;
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    const ip = Array.isArray(realIp) ? realIp[0] : realIp;
    if (ip && ip !== "::1" && ip !== "127.0.0.1") return ip;
  }

  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  if (ip === "::1" || ip === "127.0.0.1") return null; // localhost — skip geo
  return ip ?? null;
}


/* ═══════════════════════════════════════════════════════════
   IP-TO-GEO RESOLUTION
   Uses ip-api.com (free, no API key, 45 req/min per IP).
   Returns null on any failure — analytics must never throw.
 
   For production volume, swap this for:
     • MaxMind GeoLite2 (local DB, unlimited, free with signup)
     • ipinfo.io (50k/month free)
     • ip-api.com Pro (unlimited, paid)
═══════════════════════════════════════════════════════════ */

interface GeoResult {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  // isp:         string | null;
}

const _geoCache = new Map<string, { data: GeoResult; expiresAt: number }>();
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours per IP

export async function resolveGeo(ip: string): Promise<GeoResult> {
  const nullResult: GeoResult = {
    country: null, countryCode: null, region: null,
    city: null, latitude: null, longitude: null,
    timezone: null,
    // isp: null,
  };

  if (!ip) return nullResult;

  // Check cache first
  const cached = _geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    // ip-api.com — free tier, returns JSON, no API key needed.
    // Fields param limits response to exactly what we need (faster).
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp`,
      { signal: AbortSignal.timeout(3000) }, // 3 s hard timeout
    );

    if (!res.ok) return nullResult;

    const data = await res.json();

    if (data.status !== "success") return nullResult;

    const result: GeoResult = {
      country: data.country ?? null,
      countryCode: data.countryCode ?? null,
      region: data.regionName ?? null,
      city: data.city ?? null,
      latitude: typeof data.lat === "number" ? data.lat : null,
      longitude: typeof data.lon === "number" ? data.lon : null,
      timezone: data.timezone ?? null,
      // isp:         data.isp         ?? null,
    };

    _geoCache.set(ip, { data: result, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.warn("[analytics] geo lookup failed for", ip, err);
    return nullResult;
  }
}



/* ═══════════════════════════════════════════════════════════
   UPSERT VISITOR
   Finds or creates a visitor record by fingerprint/cookieId.
═══════════════════════════════════════════════════════════ */

async function upsertVisitor(params: {
  fingerprint: string;
  cookieId: string;
  geo: GeoResult;
  utm: { source?: string; campaign?: string };
}) {
  const { fingerprint, cookieId, geo, utm } = params;

  // Try fingerprint first, then cookie
  let visitor = await prisma.analyticsVisitor.findFirst({
    where: { OR: [{ fingerprint }, { cookieId }] },
  });

  if (!visitor) {
    visitor = await prisma.analyticsVisitor.create({
      data: {
        fingerprint,
        cookieId,
        isReturning: false,
        sessionCount: 0,
        pageViewCount: 0,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        country: geo.country,
        countryCode: geo.countryCode,
        region: geo.region,
        city: geo.city,
        initialUtmSource: utm.source ?? null,
        initialUtmCampaign: utm.campaign ?? null,
      },
    });
  } else {
    // Update last seen + geo (geo may have been null on first visit)
    visitor = await prisma.analyticsVisitor.update({
      where: { id: visitor.id },
      data: {
        lastSeenAt: new Date(),
        isReturning: true,
        // Only backfill geo if it was missing
        ...(visitor.country == null && geo.country ? {
          country: geo.country,
          countryCode: geo.countryCode,
          region: geo.region,
          city: geo.city,
        } : {}),
      },
    });
  }

  return visitor;
}

/* ═══════════════════════════════════════════════════════════
   DATE HELPERS
═══════════════════════════════════════════════════════════ */

/**
 * Parse ?from and ?to query params into UTC Date objects.
 * Defaults: from = 30 days ago, to = now.
 */
function parseDateRange(query: Record<string, any>): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to as string) : new Date();
  const from = query.from ? new Date(query.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Return every calendar day between two dates as ISO date strings.
 * Used to fill in zeros for days with no data.
 */
function daysInRange(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Zero-fill a keyed map of day → value against a full day list.
 */
function fillDays(
  rows: { date: string; value: number }[],
  allDays: string[],
): { date: string; value: number }[] {
  const map = new Map(rows.map((r) => [r.date, r.value]));
  return allDays.map((d) => ({ date: d, value: map.get(d) ?? 0 }));
}

/** Clamp pagination params. */
function paginate(query: Record<string, any>): { page: number; limit: number; skip: number } {
  const page = Math.max(1, Number(query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
  return { page, limit, skip: (page - 1) * limit };
}

/** Build a percentage change label: ((current - prev) / prev) * 100. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
}



/* ═══════════════════════════════════════════════════════════
   POST /analytics/session/start
   Body: { fingerprint, cookieId, device, referrer, utm, location }
═══════════════════════════════════════════════════════════ */

export async function sessionStart(req: Request, res: Response) {
  try {
    const {
      fingerprint,
      cookieId,
      device = {},
      referrer = {},
      utm = {},
      location: clientHints = {},
    } = req.body;

    if (!fingerprint || !cookieId) {
      return sendErrorResponse(res, 400, "fingerprint and cookieId are required");
    }

    // 1. Resolve geo from the real client IP (authoritative)
    const clientIp = extractClientIp(req);
    const geo = clientIp ? await resolveGeo(clientIp) : {
      country: null, countryCode: null, region: null,
      city: null, latitude: null, longitude: null,
      timezone: null, isp: null,
    };

    // 2. Supplement timezone from client hints if IP geo didn't return one
    const timezone = geo.timezone ?? clientHints.timezone ?? null;

    // 3. Upsert visitor
    const visitor = await upsertVisitor({
      fingerprint,
      cookieId,
      geo,
      utm: { source: utm.source, campaign: utm.campaign },
    });

    // 4. Create session
    const session = await prisma.analyticsSession.create({
      data: {
        visitorId: visitor.id,
        startedAt: new Date(),
        bounced: true,          // default true; flipped on 2nd page view
        pageViewCount: 0,

        // Device
        deviceType: device.type ?? "UNKNOWN",
        browser: device.browser ?? null,
        browserVersion: device.browserVersion ?? null,
        os: device.os ?? null,
        osVersion: device.osVersion ?? null,
        deviceBrand: device.brand ?? null,
        deviceModel: device.model ?? null,
        screenWidth: device.screenWidth ?? null,
        screenHeight: device.screenHeight ?? null,
        viewportWidth: device.viewportWidth ?? null,
        viewportHeight: device.viewportHeight ?? null,

        // Referrer
        // referrerUrl:    referrer.url  ?? null,
        // referrerHost:   referrer.host ?? null,
        // referrerType:   referrer.type ?? "direct",
        // Referrer
        referrer: referrer.url ?? null,   // was: referrerUrl
        referrerHost: referrer.host ?? null,
        referrerType: referrer.type ?? "direct",

        // UTM
        utmSource: utm.source ?? null,
        utmMedium: utm.medium ?? null,
        utmCampaign: utm.campaign ?? null,
        utmContent: utm.content ?? null,
        utmTerm: utm.term ?? null,

        // Geo — resolved from IP (accurate)
        country: geo.country ?? null,
        countryCode: geo.countryCode ?? null,
        region: geo.region ?? null,
        city: geo.city ?? null,
        latitude: geo.latitude ?? null,
        longitude: geo.longitude ?? null,
        timezone,
        // isp:         geo.isp         ?? null,

        // Client language (from navigator.language)
        language: clientHints.language ?? null,
      },
    });

    // 5. Increment visitor session count
    await prisma.analyticsVisitor.update({
      where: { id: visitor.id },
      data: { sessionCount: { increment: 1 } },
    });

    return sendSuccessResponse(res, 200, "Session started", {
      visitorId: visitor.id,
      sessionId: session.id,
    });
  } catch (err: any) {
    console.error("[sessionStart]", err);
    return sendErrorResponse(res, 500, "Failed to start session");
  }
}

/* ═══════════════════════════════════════════════════════════
   POST /analytics/session/end
   Body: { sessionId, durationSec, exitPath }
═══════════════════════════════════════════════════════════ */

export async function sessionEnd(req: Request, res: Response) {
  try {
    const { sessionId, durationSec, exitPath } = req.body;
    if (!sessionId) return sendErrorResponse(res, 400, "sessionId required");

    await prisma.analyticsSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        durationSec: typeof durationSec === "number" ? durationSec : null,
        exitPage: exitPath ?? null,   // was: exitPath
      },
    });

    return sendSuccessResponse(res, 200, "Session ended");
  } catch (err: any) {
    console.error("[sessionEnd]", err);
    return sendErrorResponse(res, 500, "Failed to end session");
  }
}

/* ═══════════════════════════════════════════════════════════
   POST /analytics/pageview
   Body: { sessionId, visitorId, url, path, host, title,
           query, hash, referrer, isSpa, performance }
═══════════════════════════════════════════════════════════ */

export async function trackPageView(req: Request, res: Response) {
  try {
    const {
      sessionId, visitorId, url, path, host, title,
      query = null, hash = null, referrer = null,
      isSpa = false, performance: perf = {},
    } = req.body;

    if (!sessionId || !visitorId || !path) {
      return sendErrorResponse(res, 400, "sessionId, visitorId, path required");
    }

    const pageView = await prisma.analyticsPageView.create({
      data: {
        sessionId,
        visitorId,
        // url: url ?? null,
        url: url ?? path, 
        path,
        host: host ?? null,
        title: title ?? null,
        query,
        hash,
        referrer,
        isSpa,
        viewedAt: new Date(),

        // Core Web Vitals (may be null on first load — sent with next pageview)
        lcp: perf.lcp ?? null,
        fid: perf.fid ?? null,
        cls: perf.cls ?? null,
        fcp: perf.fcp ?? null,
        ttfb: perf.ttfb ?? null,
      },
    });

    // Increment session page view count + un-bounce if 2nd+ view
    const session = await prisma.analyticsSession.update({
      where: { id: sessionId },
      data: {
        pageViewCount: { increment: 1 },
        bounced: false, // any second page view means not bounced
      },
      select: { pageViewCount: true },
    });

    // First page view: bounced is still true (set in session/start)
    // If this is the first pageview, revert the bounced=false above
    if (session.pageViewCount === 1) {
      await prisma.analyticsSession.update({
        where: { id: sessionId },
        data: { bounced: true },
      });
    }

    // Increment visitor page view count
    await prisma.analyticsVisitor.update({
      where: { id: visitorId },
      data: { pageViewCount: { increment: 1 } },
    });

    return sendSuccessResponse(res, 200, "Page view recorded", {
      pageViewId: pageView.id,
    });
  } catch (err: any) {
    console.error("[trackPageView]", err);
    return sendErrorResponse(res, 500, "Failed to record page view");
  }
}



/* ═══════════════════════════════════════════════════════════
   POST /analytics/event
   Body: { sessionId, visitorId, pageViewId, category, name,
           label, value, meta, element, pagePath }
═══════════════════════════════════════════════════════════ */

export async function trackEvent(req: Request, res: Response) {
  try {
    const {
      sessionId, visitorId, pageViewId = null,
      category = "CUSTOM", name, label = null,
      value = null, meta = null, element = null,
      pagePath = null,
    } = req.body;

    if (!sessionId || !visitorId || !name) {
      return sendErrorResponse(res, 400, "sessionId, visitorId, name required");
    }

    // Handle the special page_leave event — update pageview with scroll + time data
    if (category === "SCROLL" && name === "page_leave" && pageViewId && meta) {
      await prisma.analyticsPageView.update({
        where: { id: pageViewId },
        data: {
          timeOnPageSec: typeof meta.timeOnPageSec === "number" ? meta.timeOnPageSec : null,
          maxScrollPct: typeof meta.maxScrollPct === "number" ? meta.maxScrollPct : null,
        },
      }).catch(() => { }); // non-fatal if pageview no longer exists
    }

    // await prisma.analyticsEvent.create({
    //   data: {
    //     sessionId,
    //     visitorId,
    //     pageViewId,
    //     category,
    //     name,
    //     label,
    //     value: typeof value === "number" ? value : null,
    //     meta: meta ? meta : undefined,
    //     element: element ? element : undefined,
    //     pagePath,
    //     occurredAt: new Date(),
    //   },
    // });

    await prisma.analyticsEvent.create({
      data: {
        sessionId,
        visitorId,
        pageViewId,
        category,
        name,
        label,
        value: typeof value === "number" ? value : null,
        meta: meta ?? undefined,

        // Flatten the element object into the schema's separate columns
        elementTag: element?.tag ?? null,
        elementId: element?.id ?? null,
        elementClass: element?.class ?? null,
        elementText: element?.text ?? null,
        elementHref: element?.href ?? null,

        pagePath,
        occurredAt: new Date(),
      },
    });

    return sendSuccessResponse(res, 200, "Event recorded");
  } catch (err: any) {
    console.error("[trackEvent]", err);
    return sendErrorResponse(res, 500, "Failed to record event");
  }
}

/* ═══════════════════════════════════════════════════════════
   1. OVERVIEW
   GET /analytics/overview?from=&to=
   Summary KPIs with period-over-period comparison.
═══════════════════════════════════════════════════════════ */
export async function getOverview(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = new Date(from);

    /* ── Current period ──────────────────────────────────────── */
    const [
      sessions,
      pageViews,
      uniqueVisitors,
      newVisitors,
      bouncedSessions,
      durationAgg,
      prevSessions,
      prevPageViews,
      prevUnique,
      eventCount,
    ] = await Promise.all([
      prisma.analyticsSession.count({ where: { startedAt: { gte: from, lte: to } } }),

      prisma.analyticsPageView.count({ where: { viewedAt: { gte: from, lte: to } } }),

      prisma.analyticsSession.findMany({
        where: { startedAt: { gte: from, lte: to } },
        distinct: ["visitorId"],
        select: { visitorId: true },
      }).then((r) => r.length),

      // New visitors: firstSeenAt falls in this window
      prisma.analyticsVisitor.count({ where: { firstSeenAt: { gte: from, lte: to } } }),

      prisma.analyticsSession.count({
        where: { startedAt: { gte: from, lte: to }, bounced: true },
      }),

      prisma.analyticsSession.aggregate({
        where: { startedAt: { gte: from, lte: to }, durationSec: { not: null } },
        _avg: { durationSec: true },
        _sum: { durationSec: true },
      }),

      // Previous period comparisons
      prisma.analyticsSession.count({ where: { startedAt: { gte: prevFrom, lte: prevTo } } }),
      prisma.analyticsPageView.count({ where: { viewedAt: { gte: prevFrom, lte: prevTo } } }),
      prisma.analyticsSession.findMany({
        where: { startedAt: { gte: prevFrom, lte: prevTo } },
        distinct: ["visitorId"],
        select: { visitorId: true },
      }).then((r) => r.length),

      prisma.analyticsEvent.count({ where: { occurredAt: { gte: from, lte: to } } }),
    ]);

    const bounceRate = sessions > 0 ? Math.round((bouncedSessions / sessions) * 100 * 10) / 10 : 0;
    const avgSessionDuration = Math.round(durationAgg._avg.durationSec ?? 0);
    const returningVisitors = uniqueVisitors - newVisitors;

    return sendSuccessResponse(res, 200, "Overview fetched", {
      period: { from, to },
      kpis: {
        sessions: { value: sessions, change: pctChange(sessions, prevSessions) },
        pageViews: { value: pageViews, change: pctChange(pageViews, prevPageViews) },
        uniqueVisitors: { value: uniqueVisitors, change: pctChange(uniqueVisitors, prevUnique) },
        newVisitors: { value: newVisitors },
        returningVisitors: { value: returningVisitors },
        bounceRate: { value: bounceRate, unit: "%" },
        avgSessionDuration: { value: avgSessionDuration, unit: "sec" },
        events: { value: eventCount },
      },
    });
  } catch (err: any) {
    console.error("[getOverview]", err);
    return sendErrorResponse(res, 500, "Failed to fetch overview");
  }
}

/* ═══════════════════════════════════════════════════════════
   2. TRAFFIC OVER TIME
   GET /analytics/traffic?from=&to=&granularity=day|week
   Sessions + page views per day, zero-filled.
═══════════════════════════════════════════════════════════ */
export async function getTrafficOverTime(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const allDays = daysInRange(from, to);

    /* Sessions per day */
    const sessionRows = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "startedAt") AS date,
             COUNT(*) AS count
        FROM "AnalyticsSession"
       WHERE "startedAt" >= ${from} AND "startedAt" <= ${to}
       GROUP BY 1
       ORDER BY 1`;

    /* Page views per day */
    const pvRows = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "viewedAt") AS date,
             COUNT(*) AS count
        FROM "AnalyticsPageView"
       WHERE "viewedAt" >= ${from} AND "viewedAt" <= ${to}
       GROUP BY 1
       ORDER BY 1`;

    /* Unique visitors per day (distinct visitorId) */
    const uvRows = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "startedAt") AS date,
             COUNT(DISTINCT "visitorId") AS count
        FROM "AnalyticsSession"
       WHERE "startedAt" >= ${from} AND "startedAt" <= ${to}
       GROUP BY 1
       ORDER BY 1`;

    const toRow = (rows: { date: string; count: bigint }[]) =>
      rows.map((r) => ({ date: new Date(r.date).toISOString().slice(0, 10), value: Number(r.count) }));

    return sendSuccessResponse(res, 200, "Traffic fetched", {
      period: { from, to },
      days: allDays,
      series: {
        sessions: fillDays(toRow(sessionRows), allDays),
        pageViews: fillDays(toRow(pvRows), allDays),
        uniqueVisitors: fillDays(toRow(uvRows), allDays),
      },
    });
  } catch (err: any) {
    console.error("[getTrafficOverTime]", err);
    return sendErrorResponse(res, 500, "Failed to fetch traffic");
  }
}

/* ═══════════════════════════════════════════════════════════
   3. TOP PAGES
   GET /analytics/pages?from=&to=&limit=&page=&host=
   Ranked by total views; includes avg time-on-page, bounce proxy.
═══════════════════════════════════════════════════════════ */
export async function getTopPages(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { skip, limit, page } = paginate(req.query);
    const host = req.query.host as string | undefined;

    const where: any = {
      viewedAt: { gte: from, lte: to },
      ...(host ? { host } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.analyticsPageView.groupBy({
        by: ["path"],
        where,
        _count: { id: true },
        _avg: { timeOnPageSec: true, maxScrollPct: true },
        orderBy: { _count: { id: "desc" } },
        skip,
        take: limit,
      }),
      prisma.analyticsPageView.groupBy({
        by: ["path"],
        where,
        _count: { id: true },
      }).then((r) => r.length),
    ]);

    // Fetch unique visitors per path via raw (groupBy can't do distinct count)
    const paths = rows.map((r) => r.path);
    const uvPerPath = paths.length
      ? await prisma.$queryRaw<{ path: string; uv: bigint }[]>`
          SELECT path, COUNT(DISTINCT "visitorId") AS uv
            FROM "AnalyticsPageView"
           WHERE "viewedAt" >= ${from} AND "viewedAt" <= ${to}
             AND path = ANY(${paths}::text[])
           GROUP BY path`
      : [];

    const uvMap = new Map(uvPerPath.map((r) => [r.path, Number(r.uv)]));

    const data = rows.map((r) => ({
      path: r.path,
      views: r._count.id,
      uniqueVisitors: uvMap.get(r.path) ?? 0,
      avgTimeOnPageSec: Math.round(r._avg.timeOnPageSec ?? 0),
      avgScrollPct: Math.round(r._avg.maxScrollPct ?? 0),
    }));

    return sendSuccessResponse(res, 200, "Top pages fetched", {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("[getTopPages]", err);
    return sendErrorResponse(res, 500, "Failed to fetch pages");
  }
}

/* ═══════════════════════════════════════════════════════════
   4. TRAFFIC SOURCES
   GET /analytics/referrers?from=&to=
   Breakdown by referrerType, top referring hostnames, and UTM sources.
═══════════════════════════════════════════════════════════ */
export async function getTrafficSources(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const where = { startedAt: { gte: from, lte: to } };

    const [byType, byHost, byUtmSource, byUtmCampaign] = await Promise.all([
      // Sessions by referrerType
      prisma.analyticsSession.groupBy({
        by: ["referrerType"],
        where,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),

      // Top referring hostnames (exclude nulls = direct)
      prisma.analyticsSession.groupBy({
        by: ["referrerHost"],
        where: { ...where, referrerHost: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),

      // Top UTM sources
      prisma.analyticsSession.groupBy({
        by: ["utmSource"],
        where: { ...where, utmSource: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),

      // UTM campaign breakdown
      prisma.analyticsSession.groupBy({
        by: ["utmCampaign", "utmSource", "utmMedium"],
        where: { ...where, utmCampaign: { not: null } },
        _count: { id: true },
        _avg: { durationSec: true },
        orderBy: { _count: { id: "desc" } },
        take: 30,
      }),
    ]);

    const total = byType.reduce((s, r) => s + r._count.id, 0);

    return sendSuccessResponse(res, 200, "Traffic sources fetched", {
      period: { from, to },
      byType: byType.map((r) => ({
        type: r.referrerType ?? "direct",
        sessions: r._count.id,
        pct: total > 0 ? Math.round((r._count.id / total) * 1000) / 10 : 0,
      })),
      topReferrers: byHost.map((r) => ({
        host: r.referrerHost,
        sessions: r._count.id,
      })),
      utmSources: byUtmSource.map((r) => ({
        source: r.utmSource,
        sessions: r._count.id,
      })),
      campaigns: byUtmCampaign.map((r) => ({
        campaign: r.utmCampaign,
        source: r.utmSource,
        medium: r.utmMedium,
        sessions: r._count.id,
        avgDurationSec: Math.round(r._avg.durationSec ?? 0),
      })),
    });
  } catch (err: any) {
    console.error("[getTrafficSources]", err);
    return sendErrorResponse(res, 500, "Failed to fetch sources");
  }
}

/* ═══════════════════════════════════════════════════════════
   5. DEVICES
   GET /analytics/devices?from=&to=
   Device type, browser, OS, and screen size breakdown.
═══════════════════════════════════════════════════════════ */
export async function getDeviceBreakdown(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const where = { startedAt: { gte: from, lte: to } };

    const [byDeviceType, byBrowser, byOs, byBrowserVersion] = await Promise.all([
      prisma.analyticsSession.groupBy({
        by: ["deviceType"],
        where,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.analyticsSession.groupBy({
        by: ["browser"],
        where: { ...where, browser: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 15,
      }),
      prisma.analyticsSession.groupBy({
        by: ["os"],
        where: { ...where, os: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 15,
      }),
      // Browser + version combos
      prisma.analyticsSession.groupBy({
        by: ["browser", "browserVersion"],
        where: { ...where, browser: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
    ]);

    // Screen size buckets from raw (viewport width ranges)
    const screenBuckets = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
      SELECT
        CASE
          WHEN "viewportWidth" < 480   THEN 'xs (<480)'
          WHEN "viewportWidth" < 768   THEN 'sm (480-767)'
          WHEN "viewportWidth" < 1024  THEN 'md (768-1023)'
          WHEN "viewportWidth" < 1280  THEN 'lg (1024-1279)'
          ELSE                              'xl (1280+)'
        END AS bucket,
        COUNT(*) AS count
      FROM "AnalyticsSession"
      WHERE "startedAt" >= ${from}
        AND "startedAt" <= ${to}
        AND "viewportWidth" IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC`;

    const total = byDeviceType.reduce((s, r) => s + r._count.id, 0);
    const pct = (n: number) => total > 0 ? Math.round((n / total) * 1000) / 10 : 0;

    return sendSuccessResponse(res, 200, "Device breakdown fetched", {
      period: { from, to },
      deviceTypes: byDeviceType.map((r) => ({
        type: r.deviceType, sessions: r._count.id, pct: pct(r._count.id),
      })),
      browsers: byBrowser.map((r) => ({
        browser: r.browser, sessions: r._count.id, pct: pct(r._count.id),
      })),
      operatingSystems: byOs.map((r) => ({
        os: r.os, sessions: r._count.id, pct: pct(r._count.id),
      })),
      browserVersions: byBrowserVersion.map((r) => ({
        browser: r.browser, version: r.browserVersion, sessions: r._count.id,
      })),
      screenSizes: screenBuckets.map((r) => ({
        bucket: r.bucket, sessions: Number(r.count),
      })),
    });
  } catch (err: any) {
    console.error("[getDeviceBreakdown]", err);
    return sendErrorResponse(res, 500, "Failed to fetch devices");
  }
}

/* ═══════════════════════════════════════════════════════════
   6. GEO
   GET /analytics/geo?from=&to=&limit=
   Country and city breakdown, with lat/lng for map rendering.
═══════════════════════════════════════════════════════════ */
export async function getGeoBreakdown(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const limit = Math.min(100, Number(req.query.limit ?? 50));
    const where = { startedAt: { gte: from, lte: to } };

    const [byCountry, byCity, byRegion] = await Promise.all([
      prisma.analyticsSession.groupBy({
        by: ["country", "countryCode"],
        where: { ...where, country: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: limit,
      }),
      prisma.analyticsSession.groupBy({
        by: ["city", "country", "countryCode"],
        where: { ...where, city: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: limit,
      }),
      prisma.analyticsSession.groupBy({
        by: ["region", "countryCode"],
        where: { ...where, region: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: limit,
      }),
    ]);

    // Average lat/lng per country (for map pin placement)
    const countryCoords = await prisma.$queryRaw<{
      countryCode: string;
      lat: number;
      lng: number;
    }[]>`
      SELECT "countryCode",
             AVG(latitude)  AS lat,
             AVG(longitude) AS lng
        FROM "AnalyticsSession"
       WHERE "startedAt" >= ${from}
         AND "startedAt" <= ${to}
         AND "countryCode" IS NOT NULL
         AND latitude IS NOT NULL
       GROUP BY "countryCode"`;

    const coordMap = new Map(countryCoords.map((r) => [r.countryCode, { lat: r.lat, lng: r.lng }]));
    const total = byCountry.reduce((s, r) => s + r._count.id, 0);

    return sendSuccessResponse(res, 200, "Geo breakdown fetched", {
      period: { from, to },
      countries: byCountry.map((r) => ({
        country: r.country,
        countryCode: r.countryCode,
        sessions: r._count.id,
        pct: total > 0 ? Math.round((r._count.id / total) * 1000) / 10 : 0,
        coords: r.countryCode ? coordMap.get(r.countryCode) ?? null : null,
      })),
      cities: byCity.map((r) => ({
        city: r.city,
        country: r.country,
        countryCode: r.countryCode,
        sessions: r._count.id,
      })),
      regions: byRegion.map((r) => ({
        region: r.region,
        countryCode: r.countryCode,
        sessions: r._count.id,
      })),
    });
  } catch (err: any) {
    console.error("[getGeoBreakdown]", err);
    return sendErrorResponse(res, 500, "Failed to fetch geo data");
  }
}

/* ═══════════════════════════════════════════════════════════
   7. EVENTS
   GET /analytics/events?from=&to=&category=&name=&path=&limit=
   Top events, breakdown by category, event trend over time.
═══════════════════════════════════════════════════════════ */
export async function getEventReport(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { skip, limit, page } = paginate(req.query);
    const category = req.query.category as string | undefined;
    const name = req.query.name as string | undefined;
    const pagePath = req.query.path as string | undefined;

    const where: any = {
      occurredAt: { gte: from, lte: to },
      ...(category ? { category } : {}),
      ...(name ? { name } : {}),
      ...(pagePath ? { pagePath: { contains: pagePath } } : {}),
    };

    const [topEvents, byCategory, eventTrend, total] = await Promise.all([
      // Top events by frequency
      prisma.analyticsEvent.groupBy({
        by: ["category", "name", "label", "pagePath"],
        where,
        _count: { id: true },
        _avg: { value: true },
        orderBy: { _count: { id: "desc" } },
        skip,
        take: limit,
      }),

      // Events by category
      prisma.analyticsEvent.groupBy({
        by: ["category"],
        where,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),

      // Event trend per day
      prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE_TRUNC('day', "occurredAt") AS date, COUNT(*) AS count
          FROM "AnalyticsEvent"
         WHERE "occurredAt" >= ${from} AND "occurredAt" <= ${to}
           ${category ? Prisma.sql`AND category = ${category}` : Prisma.empty}
         GROUP BY 1
         ORDER BY 1`,

      // Total distinct event names (for pagination)
      prisma.analyticsEvent.groupBy({
        by: ["name"],
        where,
        _count: { id: true },
      }).then((r) => r.length),
    ]);

    // Top pages where events fire
    const topEventPages = await prisma.analyticsEvent.groupBy({
      by: ["pagePath"],
      where: { ...where, pagePath: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    });

    const allDays = daysInRange(from, to);

    return sendSuccessResponse(res, 200, "Events fetched", {
      period: { from, to },
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      topEvents: topEvents.map((r) => ({
        category: r.category,
        name: r.name,
        label: r.label,
        pagePath: r.pagePath,
        count: r._count.id,
        avgValue: r._avg.value != null ? Math.round(r._avg.value * 100) / 100 : null,
      })),
      byCategory: byCategory.map((r) => ({
        category: r.category,
        count: r._count.id,
      })),
      trend: fillDays(
        eventTrend.map((r) => ({
          date: new Date(r.date).toISOString().slice(0, 10),
          value: Number(r.count),
        })),
        allDays,
      ),
      topPages: topEventPages.map((r) => ({
        path: r.pagePath,
        count: r._count.id,
      })),
    });
  } catch (err: any) {
    console.error("[getEventReport]", err);
    return sendErrorResponse(res, 500, "Failed to fetch events");
  }
}

/* ═══════════════════════════════════════════════════════════
   8. CORE WEB VITALS
   GET /analytics/vitals?from=&to=&path=&limit=
   LCP, FID, CLS, FCP, TTFB — per page with pass/fail buckets.
   Thresholds per Google:
     LCP: good <2500ms, needs improvement <4000ms, poor ≥4000ms
     FID: good <100ms,  needs improvement <300ms,  poor ≥300ms
     CLS: good <0.1,    needs improvement <0.25,   poor ≥0.25
     FCP: good <1800ms, needs improvement <3000ms, poor ≥3000ms
     TTFB:good <800ms,  needs improvement <1800ms, poor ≥1800ms
═══════════════════════════════════════════════════════════ */
export async function getCoreWebVitals(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { limit } = paginate(req.query);
    const filterPath = req.query.path as string | undefined;

    const where: any = {
      viewedAt: { gte: from, lte: to },
      ...(filterPath ? { path: { contains: filterPath } } : {}),
    };

    /* ── Site-wide averages ──────────────────────────────────── */
    const siteAvg = await prisma.analyticsPageView.aggregate({
      where,
      _avg: { lcp: true, fid: true, cls: true, fcp: true, ttfb: true },
      _count: { id: true },
    });

    /* ── Per-page averages, ranked by worst LCP ──────────────── */
    const perPage = await prisma.analyticsPageView.groupBy({
      by: ["path"],
      where: { ...where, lcp: { not: null } },
      _avg: { lcp: true, fid: true, cls: true, fcp: true, ttfb: true },
      _count: { id: true },
      orderBy: { _avg: { lcp: "desc" } },
      take: limit,
    });

    /* ── LCP pass/fail distribution ─────────────────────────── */
    const lcpBuckets = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
      SELECT
        CASE
          WHEN lcp < 2500 THEN 'good'
          WHEN lcp < 4000 THEN 'needs improvement'
          ELSE                 'poor'
        END AS bucket,
        COUNT(*) AS count
        FROM "AnalyticsPageView"
       WHERE "viewedAt" >= ${from} AND "viewedAt" <= ${to}
         AND lcp IS NOT NULL
       GROUP BY 1`;

    const clsBuckets = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
      SELECT
        CASE
          WHEN cls < 0.1  THEN 'good'
          WHEN cls < 0.25 THEN 'needs improvement'
          ELSE                 'poor'
        END AS bucket,
        COUNT(*) AS count
        FROM "AnalyticsPageView"
       WHERE "viewedAt" >= ${from} AND "viewedAt" <= ${to}
         AND cls IS NOT NULL
       GROUP BY 1`;

    function vitalsGrade(lcp: number | null, cls: number | null): "good" | "needs improvement" | "poor" | "unknown" {
      if (lcp == null || cls == null) return "unknown";
      if (lcp < 2500 && cls < 0.1) return "good";
      if (lcp < 4000 && cls < 0.25) return "needs improvement";
      return "poor";
    }

    return sendSuccessResponse(res, 200, "Web vitals fetched", {
      period: { from, to },
      siteWide: {
        samples: siteAvg._count.id,
        lcp: siteAvg._avg.lcp != null ? Math.round(siteAvg._avg.lcp) : null,
        fid: siteAvg._avg.fid != null ? Math.round(siteAvg._avg.fid) : null,
        cls: siteAvg._avg.cls != null ? Math.round(siteAvg._avg.cls * 1000) / 1000 : null,
        fcp: siteAvg._avg.fcp != null ? Math.round(siteAvg._avg.fcp) : null,
        ttfb: siteAvg._avg.ttfb != null ? Math.round(siteAvg._avg.ttfb) : null,
        grade: vitalsGrade(siteAvg._avg.lcp, siteAvg._avg.cls),
      },
      worstPages: perPage.map((r) => ({
        path: r.path,
        samples: r._count.id,
        lcp: r._avg.lcp != null ? Math.round(r._avg.lcp) : null,
        fid: r._avg.fid != null ? Math.round(r._avg.fid) : null,
        cls: r._avg.cls != null ? Math.round(r._avg.cls * 1000) / 1000 : null,
        fcp: r._avg.fcp != null ? Math.round(r._avg.fcp) : null,
        ttfb: r._avg.ttfb != null ? Math.round(r._avg.ttfb) : null,
        grade: vitalsGrade(r._avg.lcp, r._avg.cls),
      })),
      lcpDistribution: lcpBuckets.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
      clsDistribution: clsBuckets.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
    });
  } catch (err: any) {
    console.error("[getCoreWebVitals]", err);
    return sendErrorResponse(res, 500, "Failed to fetch vitals");
  }
}

/* ═══════════════════════════════════════════════════════════
   9. VISITOR LIST
   GET /analytics/visitors?from=&to=&page=&limit=&country=&isReturning=
   Paginated visitor list with session totals.
═══════════════════════════════════════════════════════════ */
export async function getVisitorList(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { skip, limit, page } = paginate(req.query);

    const where: any = {
      lastSeenAt: { gte: from, lte: to },
    };
    if (req.query.country) where.country = req.query.country;
    if (req.query.isReturning) where.isReturning = req.query.isReturning === "true";
    if (req.query.accountId) where.accountId = req.query.accountId;
    if (req.query.search) {
      where.OR = [
        { city: { contains: req.query.search as string, mode: "insensitive" } },
        { country: { contains: req.query.search as string, mode: "insensitive" } },
      ];
    }

    const [visitors, total] = await Promise.all([
      prisma.analyticsVisitor.findMany({
        where,
        skip,
        take: limit,
        orderBy: { lastSeenAt: "desc" },
        select: {
          id: true,
          fingerprint: true,
          cookieId: true,
          accountId: true,
          sessionCount: true,
          pageViewCount: true,
          isReturning: true,
          firstSeenAt: true,
          lastSeenAt: true,
          country: true,
          countryCode: true,
          region: true,
          city: true,
          initialUtmSource: true,
          initialUtmCampaign: true,
          // Latest session for device info
          sessions: {
            orderBy: { startedAt: "desc" },
            take: 1,
            select: {
              deviceType: true,
              browser: true,
              os: true,
              referrerType: true,
              utmSource: true,
            },
          },
        },
      }),
      prisma.analyticsVisitor.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Visitors fetched", {
      data: visitors.map((v) => ({
        ...v,
        latestSession: v.sessions[0] ?? null,
        sessions: undefined,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    console.error("[getVisitorList]", err);
    return sendErrorResponse(res, 500, "Failed to fetch visitors");
  }
}

/* ═══════════════════════════════════════════════════════════
   10. VISITOR DETAIL
   GET /analytics/visitors/:visitorId
   Full profile: all sessions, page journeys, events.
═══════════════════════════════════════════════════════════ */
export async function getVisitorDetail(req: Request, res: Response) {
  try {
    const { visitorId } = req.params;

    const visitor = await prisma.analyticsVisitor.findUnique({
      where: { id: visitorId },
      include: {
        sessions: {
          orderBy: { startedAt: "desc" },
          take: 20,
          include: {
            pageViews: {
              orderBy: { viewedAt: "asc" },
              select: {
                id: true, path: true, title: true,
                viewedAt: true, timeOnPageSec: true, maxScrollPct: true,
              },
            },
          },
        },
      },
    });

    if (!visitor) return sendErrorResponse(res, 404, "Visitor not found");

    // Recent events (last 100)
    const events = await prisma.analyticsEvent.findMany({
      where: { visitorId },
      orderBy: { occurredAt: "desc" },
      take: 100,
      select: {
        id: true, category: true, name: true, label: true,
        value: true, pagePath: true, occurredAt: true,
      },
    });

    return sendSuccessResponse(res, 200, "Visitor fetched", { visitor, events });
  } catch (err: any) {
    console.error("[getVisitorDetail]", err);
    return sendErrorResponse(res, 500, "Failed to fetch visitor");
  }
}

/* ═══════════════════════════════════════════════════════════
   11. REALTIME
   GET /analytics/realtime
   Sessions active in the last 5 minutes + live page counts.
═══════════════════════════════════════════════════════════ */
export async function getRealtime(req: Request, res: Response) {
  try {
    const windowMin = Number(req.query.window ?? 5);          // default: last 5 min
    const since = new Date(Date.now() - windowMin * 60 * 1000);

    const [activeSessions, activePageViews, recentEvents, topActivePages] = await Promise.all([
      // Sessions that started within the window AND have not ended
      prisma.analyticsSession.findMany({
        where: { startedAt: { gte: since }, endedAt: null },
        orderBy: { startedAt: "desc" },
        take: 50,
        select: {
          id: true, visitorId: true, startedAt: true,
          country: true, countryCode: true, city: true,
          deviceType: true, browser: true, os: true,
          referrerType: true, pageViewCount: true,
          visitor: { select: { isReturning: true, accountId: true } },
        },
      }),

      // Page views in the window
      prisma.analyticsPageView.count({ where: { viewedAt: { gte: since } } }),

      // Events in the window
      prisma.analyticsEvent.findMany({
        where: { occurredAt: { gte: since } },
        orderBy: { occurredAt: "desc" },
        take: 20,
        select: { id: true, name: true, category: true, pagePath: true, occurredAt: true },
      }),

      // Most viewed pages right now
      prisma.analyticsPageView.groupBy({
        by: ["path"],
        where: { viewedAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
    ]);

    return sendSuccessResponse(res, 200, "Realtime data fetched", {
      windowMinutes: windowMin,
      since,
      activeUsers: activeSessions.length,
      pageViews: activePageViews,
      activeSessions,
      recentEvents,
      topActivePages: topActivePages.map((r) => ({
        path: r.path,
        views: r._count.id,
      })),
    });
  } catch (err: any) {
    console.error("[getRealtime]", err);
    return sendErrorResponse(res, 500, "Failed to fetch realtime data");
  }
}

/* ═══════════════════════════════════════════════════════════
   12. SESSION DETAIL
   GET /analytics/sessions/:sessionId
   Full session with ordered page views and events.
═══════════════════════════════════════════════════════════ */
export async function getSessionDetail(req: Request, res: Response) {
  try {
    const { sessionId } = req.params;

    const session = await prisma.analyticsSession.findUnique({
      where: { id: sessionId },
      include: {
        visitor: {
          select: {
            id: true, fingerprint: true, accountId: true,
            isReturning: true, sessionCount: true,
            country: true, city: true, firstSeenAt: true,
          },
        },
        pageViews: {
          orderBy: { viewedAt: "asc" },
          select: {
            id: true, path: true, title: true,
            viewedAt: true, timeOnPageSec: true, maxScrollPct: true,
            lcp: true, fcp: true, cls: true, ttfb: true,
          },
        },
        events: {
          orderBy: { occurredAt: "asc" },
          select: {
            id: true, category: true, name: true,
            label: true, value: true, pagePath: true, occurredAt: true,
          },
        },
      },
    });

    if (!session) return sendErrorResponse(res, 404, "Session not found");

    return sendSuccessResponse(res, 200, "Session fetched", { session });
  } catch (err: any) {
    console.error("[getSessionDetail]", err);
    return sendErrorResponse(res, 500, "Failed to fetch session");
  }
}

/* ═══════════════════════════════════════════════════════════
   13. RETENTION
   GET /analytics/retention?from=&to=
   New vs returning split + cohort repeat visit counts.
═══════════════════════════════════════════════════════════ */
export async function getRetention(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);

    const [newCount, returningCount, sessionDepth] = await Promise.all([
      prisma.analyticsVisitor.count({
        where: { firstSeenAt: { gte: from, lte: to } },
      }),
      prisma.analyticsVisitor.count({
        where: { firstSeenAt: { gte: from, lte: to }, isReturning: true },
      }),
      // Distribution of session counts (how many visitors came back N times)
      prisma.$queryRaw<{ bucket: string; visitors: bigint }[]>`
        SELECT
          CASE
            WHEN "sessionCount" = 1  THEN '1 visit'
            WHEN "sessionCount" = 2  THEN '2 visits'
            WHEN "sessionCount" <= 5 THEN '3-5 visits'
            WHEN "sessionCount" <= 10 THEN '6-10 visits'
            ELSE '10+ visits'
          END AS bucket,
          COUNT(*) AS visitors
          FROM "AnalyticsVisitor"
         WHERE "firstSeenAt" >= ${from}
           AND "firstSeenAt" <= ${to}
         GROUP BY 1
         ORDER BY MIN("sessionCount")`,
    ]);

    // New vs returning trend per day
    const dailyTrend = await prisma.$queryRaw<{
      date: string; new_visitors: bigint; returning_visitors: bigint;
    }[]>`
      SELECT
        DATE_TRUNC('day', s."startedAt") AS date,
        COUNT(DISTINCT CASE WHEN v."sessionCount" = 1 THEN s."visitorId" END) AS new_visitors,
        COUNT(DISTINCT CASE WHEN v."sessionCount" > 1 THEN s."visitorId" END) AS returning_visitors
        FROM "AnalyticsSession" s
        JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
       WHERE s."startedAt" >= ${from} AND s."startedAt" <= ${to}
       GROUP BY 1
       ORDER BY 1`;

    const allDays = daysInRange(from, to);
    const dayMap = new Map(dailyTrend.map((r) => [
      new Date(r.date).toISOString().slice(0, 10),
      { newVisitors: Number(r.new_visitors), returningVisitors: Number(r.returning_visitors) },
    ]));

    return sendSuccessResponse(res, 200, "Retention fetched", {
      period: { from, to },
      summary: {
        newVisitors: newCount,
        returningVisitors: returningCount,
        retentionRate: newCount > 0
          ? Math.round((returningCount / newCount) * 1000) / 10
          : 0,
      },
      sessionDepth: sessionDepth.map((r) => ({
        bucket: r.bucket,
        visitors: Number(r.visitors),
      })),
      dailyTrend: allDays.map((d) => ({
        date: d,
        newVisitors: dayMap.get(d)?.newVisitors ?? 0,
        returningVisitors: dayMap.get(d)?.returningVisitors ?? 0,
      })),
    });
  } catch (err: any) {
    console.error("[getRetention]", err);
    return sendErrorResponse(res, 500, "Failed to fetch retention");
  }
}

/* ═══════════════════════════════════════════════════════════
   14. FUNNEL
   GET /analytics/funnel
   Body: { steps: ["/pricing", "/signup", "/dashboard"], from, to }
   Counts unique visitors who hit each step in order.
═══════════════════════════════════════════════════════════ */
export async function getFunnelAnalysis(req: Request, res: Response) {
  try {
    const steps: string[] = (req.query.steps as string ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (steps.length < 2) return sendErrorResponse(res, 400, "Provide at least 2 comma-separated steps");

    const { from, to } = parseDateRange(req.query);

    // For each step, count unique visitors who viewed that path
    const stepCounts = await Promise.all(
      steps.map((path) =>
        prisma.analyticsPageView.findMany({
          where: { path, viewedAt: { gte: from, lte: to } },
          distinct: ["visitorId"],
          select: { visitorId: true },
        }).then((r) => ({ path, visitors: new Set(r.map((x) => x.visitorId)) })),
      ),
    );

    // Sequential funnel: each step must be a subset of the previous
    const funnelResult = stepCounts.reduce<{
      path: string; visitors: number; dropPct: number | null; convPct: number;
    }[]>((acc, cur, i) => {
      if (i === 0) {
        acc.push({ path: cur.path, visitors: cur.visitors.size, dropPct: null, convPct: 100 });
        return acc;
      }
      const prev = acc[i - 1].visitors;
      const convPct = prev > 0 ? Math.round((cur.visitors.size / prev) * 1000) / 10 : 0;
      const dropPct = 100 - convPct;
      acc.push({ path: cur.path, visitors: cur.visitors.size, dropPct, convPct });
      return acc;
    }, []);

    const topOfFunnel = funnelResult[0]?.visitors ?? 0;
    const bottomOfFunnel = funnelResult[funnelResult.length - 1]?.visitors ?? 0;
    const overallConvPct = topOfFunnel > 0
      ? Math.round((bottomOfFunnel / topOfFunnel) * 1000) / 10
      : 0;

    return sendSuccessResponse(res, 200, "Funnel fetched", {
      period: { from, to },
      steps: funnelResult,
      overallConversionPct: overallConvPct,
    });
  } catch (err: any) {
    console.error("[getFunnelAnalysis]", err);
    return sendErrorResponse(res, 500, "Failed to fetch funnel");
  }
}

/* ═══════════════════════════════════════════════════════════
   15. DAILY ROLLUP  (read from pre-aggregated table)
   GET /analytics/rollup?from=&to=&groupBy=path|country|deviceType|utmCampaign
   Fast dashboard queries — never scans raw tables.
═══════════════════════════════════════════════════════════ */
export async function getDailyRollup(req: Request, res: Response) {
  try {
    const { from, to } = parseDateRange(req.query);
    const groupBy = (req.query.groupBy as string) ?? null;

    const ALLOWED_GROUP_BY = ["path", "country", "deviceType", "referrerType", "utmCampaign", "utmSource"];
    if (groupBy && !ALLOWED_GROUP_BY.includes(groupBy)) {
      return sendErrorResponse(res, 400, `groupBy must be one of: ${ALLOWED_GROUP_BY.join(", ")}`);
    }

    const rollups = await prisma.analyticsDailyRollup.findMany({
      where: {
        date: { gte: from, lte: to },
        // If no groupBy, return total rows (all dimensions null)
        ...(groupBy ? {} : {
          path: null,
          country: null,
          deviceType: null,
          referrerType: null,
          utmCampaign: null,
          utmSource: null,
        }),
      },
      orderBy: { date: "asc" },
    });

    // Aggregate totals across the date range
    const totals = rollups.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        pageViews: acc.pageViews + r.pageViews,
        uniqueVisitors: acc.uniqueVisitors + r.uniqueVisitors,
        newVisitors: acc.newVisitors + r.newVisitors,
        returningVisitors: acc.returningVisitors + r.returningVisitors,
        bounces: acc.bounces + r.bounces,
        totalDurationSec: acc.totalDurationSec + r.totalDurationSec,
      }),
      { sessions: 0, pageViews: 0, uniqueVisitors: 0, newVisitors: 0, returningVisitors: 0, bounces: 0, totalDurationSec: 0 },
    );

    const bounceRate = totals.sessions > 0
      ? Math.round((totals.bounces / totals.sessions) * 1000) / 10
      : 0;

    const avgSessionDuration = totals.sessions > 0
      ? Math.round(totals.totalDurationSec / totals.sessions)
      : 0;

    return sendSuccessResponse(res, 200, "Rollup fetched", {
      period: { from, to },
      groupBy: groupBy ?? "none",
      totals: { ...totals, bounceRate, avgSessionDuration },
      rows: rollups,
    });
  } catch (err: any) {
    console.error("[getDailyRollup]", err);
    return sendErrorResponse(res, 500, "Failed to fetch rollup");
  }
}