import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */

function safeJson(input: any): any {
  if (input === undefined || input === null) return null;
  try {
    return typeof input === "object" ? input : JSON.parse(input);
  } catch {
    return null;
  }
}

/**
 * Resolve a session by id and return it, or send a 404 and return null.
 * Caller checks the return value before proceeding.
 */
async function requireSession(sessionId: string, res: Response) {
  const session = await prisma.analyticsSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      visitorId: true,
      pageViewCount: true,
      durationSec: true,
    },
  });
  if (!session) {
    sendErrorResponse(res, 404, "Session not found");
    return null;
  }
  return session;
}

/**
 * Resolve a visitor by id, or send 404 and return null.
 */
async function requireVisitor(visitorId: string, res: Response) {
  const visitor = await prisma.analyticsVisitor.findUnique({
    where: { id: visitorId },
    select: { id: true, sessionCount: true },
  });
  if (!visitor) {
    sendErrorResponse(res, 404, "Visitor not found");
    return null;
  }
  return visitor;
}

/* ═══════════════════════════════════════════════════════════
   SESSION START
═══════════════════════════════════════════════════════════ */
export async function trackSessionStart(req: Request, res: Response) {
  try {
    const { fingerprint, cookieId, device, location, utm, referrer } =
      req.body;

    if (!fingerprint)
      return sendErrorResponse(res, 400, "fingerprint required");

    /* ── Find or create visitor ──────────────────────────────── */
    let visitor = await prisma.analyticsVisitor.findUnique({
      where: { fingerprint },
    });

    if (!visitor) {
      // BUG FIX #5: cookieId unique conflict → use upsert-safe approach.
      // If cookieId already exists on another fingerprint (e.g. browser
      // cleared localStorage but kept the cookie) we silently drop it
      // so the create never crashes on the unique constraint.
      let safeCookieId: string | undefined = cookieId;
      if (safeCookieId) {
        const cookieConflict = await prisma.analyticsVisitor.findUnique({
          where: { cookieId: safeCookieId },
          select: { id: true },
        });
        if (cookieConflict) safeCookieId = undefined; // drop conflicting cookie
      }

      visitor = await prisma.analyticsVisitor.create({
        data: {
          fingerprint,
          cookieId: safeCookieId ?? null,
          // BUG FIX #3: start at 1 — this IS the first session.
          sessionCount: 1,
          initialReferrer: referrer?.url ?? null,
          initialReferrerHost: referrer?.host ?? null,
          initialUtmSource: utm?.source ?? null,
          initialUtmMedium: utm?.medium ?? null,
          initialUtmCampaign: utm?.campaign ?? null,
          country: location?.country ?? null,
          countryCode: location?.countryCode ?? null,
          region: location?.region ?? null,
          city: location?.city ?? null,
        },
      });
    } else {
      // BUG FIX #3 + #4: increment counter AND refresh last-known location.
      await prisma.analyticsVisitor.update({
        where: { id: visitor.id },
        data: {
          sessionCount: { increment: 1 },
          // Refresh geo from the new session's location data (if provided)
          ...(location?.country && { country: location.country }),
          ...(location?.countryCode && { countryCode: location.countryCode }),
          ...(location?.region && { region: location.region }),
          ...(location?.city && { city: location.city }),
        },
      });
    }

    /* ── Create session ──────────────────────────────────────── */
    const session = await prisma.analyticsSession.create({
      data: {
        visitorId: visitor.id,

        referrer: referrer?.url ?? null,
        referrerHost: referrer?.host ?? null,
        referrerType: referrer?.type ?? null,

        utmSource: utm?.source ?? null,
        utmMedium: utm?.medium ?? null,
        utmCampaign: utm?.campaign ?? null,
        utmContent: utm?.content ?? null,
        utmTerm: utm?.term ?? null,

        deviceType: device?.type ?? "UNKNOWN",
        browser: device?.browser ?? null,
        browserVersion: device?.browserVersion ?? null,
        os: device?.os ?? null,
        osVersion: device?.osVersion ?? null,
        deviceBrand: device?.brand ?? null,
        deviceModel: device?.model ?? null,
        screenWidth: device?.screenWidth ?? null,
        screenHeight: device?.screenHeight ?? null,
        viewportWidth: device?.viewportWidth ?? null,
        viewportHeight: device?.viewportHeight ?? null,

        // Store raw IP only if explicitly opted in; prefer hashed for GDPR.
        ip: req.ip ?? null,
        ipHashed: null,

        country: location?.country ?? null,
        countryCode: location?.countryCode ?? null,
        region: location?.region ?? null,
        city: location?.city ?? null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        timezone: location?.timezone ?? null,

        language: req.headers["accept-language"] ?? null,
      },
    });

    return sendSuccessResponse(res, 200, "Session started", {
      visitorId: visitor.id,
      sessionId: session.id,
    });
  } catch (err: any) {
    console.error("[trackSessionStart]", err);
    return sendErrorResponse(res, 500, "Failed to start session");
  }
}

/* ═══════════════════════════════════════════════════════════
   PAGE VIEW
═══════════════════════════════════════════════════════════ */
export async function trackPageView(req: Request, res: Response) {
  try {
    const {
      sessionId,
      visitorId,
      url,
      path,
      query,
      hash,
      host,
      title,
      referrer,
      performance,
      isSpa = false,
    } = req.body;

    if (!sessionId || !visitorId || !path)
      return sendErrorResponse(res, 400, "sessionId, visitorId and path are required");

    // BUG FIX #10: verify both records exist before writing.
    const session = await requireSession(sessionId, res);
    if (!session) return;

    const [pageView] = await prisma.$transaction([
      prisma.analyticsPageView.create({
        data: {
          sessionId,
          visitorId,
          url: url ?? path,
          path,
          query: query ?? null,
          hash: hash ?? null,
          host: host ?? null,
          title: title ?? null,
          referrer: referrer ?? null,
          isSpa: Boolean(isSpa),
          lcp: performance?.lcp ?? null,
          fid: performance?.fid ?? null,
          cls: performance?.cls ?? null,
          fcp: performance?.fcp ?? null,
          ttfb: performance?.ttfb ?? null,
        },
      }),
      prisma.analyticsSession.update({
        where: { id: sessionId },
        data: {
          pageViewCount: { increment: 1 },
          // BUG FIX #6: set entryPage on the very first page view.
          ...(session.pageViewCount === 0 && { entryPage: path }),
        },
      }),
      prisma.analyticsVisitor.update({
        where: { id: visitorId },
        data: { pageViewCount: { increment: 1 } },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Page tracked", {
      pageViewId: pageView.id,
    });
  } catch (err: any) {
    console.error("[trackPageView]", err);
    return sendErrorResponse(res, 500, "Failed to track page");
  }
}

/* ═══════════════════════════════════════════════════════════
   EVENT
═══════════════════════════════════════════════════════════ */
export async function trackEvent(req: Request, res: Response) {
  try {
    const {
      sessionId,
      visitorId,
      pageViewId,
      category,
      name,
      label,
      value,
      meta,
      element,
      pagePath,
    } = req.body;

    if (!sessionId || !visitorId || !name)
      return sendErrorResponse(res, 400, "sessionId, visitorId and name are required");

    // BUG FIX #10: verify session exists.
    const session = await requireSession(sessionId, res);
    if (!session) return;

    await prisma.$transaction([
      prisma.analyticsEvent.create({
        data: {
          sessionId,
          visitorId,
          pageViewId: pageViewId ?? null,
          category: category ?? "CUSTOM",
          name,
          label: label ?? null,
          value: value ?? null,
          elementTag: element?.tag ?? null,
          elementId: element?.id ?? null,
          elementClass: element?.class ?? null,
          elementText: element?.text
            ? String(element.text).slice(0, 120)  // enforce 120-char cap from schema comment
            : null,
          elementHref: element?.href ?? null,
          pagePath: pagePath ?? null,
          meta: safeJson(meta),
        },
      }),
      prisma.analyticsSession.update({
        where: { id: sessionId },
        data: { eventCount: { increment: 1 } },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Event tracked");
  } catch (err: any) {
    console.error("[trackEvent]", err);
    return sendErrorResponse(res, 500, "Failed to track event");
  }
}

/* ═══════════════════════════════════════════════════════════
   SESSION END
═══════════════════════════════════════════════════════════ */
export async function trackSessionEnd(req: Request, res: Response) {
  try {
    const { sessionId, durationSec, exitPath } = req.body;

    if (!sessionId)
      return sendErrorResponse(res, 400, "sessionId required");

    // BUG FIX #8: guard against missing session.
    const session = await requireSession(sessionId, res);
    if (!session) return;

    // BUG FIX #7: compute bounced + set exitPage.
    const bounced =
      session.pageViewCount <= 1 && (durationSec ?? 0) < 30;

    await prisma.$transaction([
      prisma.analyticsSession.update({
        where: { id: sessionId },
        data: {
          endedAt: new Date(),
          durationSec: durationSec ?? null,
          exitPage: exitPath ?? null,
          bounced,
        },
      }),
      // BUG FIX #9: flip isReturning on the visitor after their first session ends.
      // sessionCount > 1 means this visitor had a prior session.
      ...(session.pageViewCount > 0
        ? [
            prisma.analyticsVisitor.updateMany({
              where: {
                id: session.visitorId,
                sessionCount: { gt: 1 },
                isReturning: false,
              },
              data: { isReturning: true },
            }),
          ]
        : []),
    ]);

    return sendSuccessResponse(res, 200, "Session ended");
  } catch (err: any) {
    console.error("[trackSessionEnd]", err);
    return sendErrorResponse(res, 500, "Failed to end session");
  }
}

/* ═══════════════════════════════════════════════════════════
   BATCH  (recommended for production)
   Accepts a mixed array of { type, ...fields } objects.
   Processes all in a single transaction with correct counter updates.
═══════════════════════════════════════════════════════════ */
export async function trackBatch(req: Request, res: Response) {
  try {
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0)
      return sendErrorResponse(res, 400, "events array required");

    // Tally per-session increments so we issue one update per session,
    // not one per event (avoids N round-trips inside the transaction).
    const sessionPageViewDelta = new Map<string, number>();
    const sessionEventDelta = new Map<string, number>();
    const visitorPageViewDelta = new Map<string, number>();
    // Track first pageview path per session for entryPage resolution
    const sessionFirstPath = new Map<string, string>();

    // Fetch current pageViewCount for sessions we'll touch (for entryPage logic).
    const sessionIds = [...new Set(events.map((e: any) => e.sessionId).filter(Boolean))];
    const existingSessions = await prisma.analyticsSession.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, pageViewCount: true },
    });
    const sessionPageViewSnapshot = new Map(
      existingSessions.map((s) => [s.id, s.pageViewCount]),
    );

    const ops: any[] = [];

    for (const e of events) {
      if (!e.sessionId || !e.visitorId) continue; // skip malformed rows silently

      /* ── pageview ─────────────────────────────────────────── */
      if (e.type === "pageview" && e.path) {
        ops.push(
          prisma.analyticsPageView.create({
            data: {
              sessionId: e.sessionId,
              visitorId: e.visitorId,        // BUG FIX #1
              url: e.url ?? e.path,
              path: e.path,
              query: e.query ?? null,
              host: e.host ?? null,
              title: e.title ?? null,
              isSpa: Boolean(e.isSpa),
              lcp: e.lcp ?? null,
              fid: e.fid ?? null,
              cls: e.cls ?? null,
              fcp: e.fcp ?? null,
              ttfb: e.ttfb ?? null,
            },
          }),
        );

        sessionPageViewDelta.set(
          e.sessionId,
          (sessionPageViewDelta.get(e.sessionId) ?? 0) + 1,
        );
        visitorPageViewDelta.set(
          e.visitorId,
          (visitorPageViewDelta.get(e.visitorId) ?? 0) + 1,
        );

        // Record first path seen in this batch for this session
        if (!sessionFirstPath.has(e.sessionId)) {
          sessionFirstPath.set(e.sessionId, e.path);
        }
      }

      /* ── event ────────────────────────────────────────────── */
      if (e.type === "event" && e.name) {
        ops.push(
          prisma.analyticsEvent.create({
            data: {
              sessionId: e.sessionId,
              visitorId: e.visitorId,
              pageViewId: e.pageViewId ?? null,
              category: e.category ?? "CUSTOM",
              name: e.name,
              label: e.label ?? null,
              value: e.value ?? null,
              pagePath: e.path ?? null,
              meta: safeJson(e.meta),
              elementTag: e.element?.tag ?? null,
              elementId: e.element?.id ?? null,
              elementClass: e.element?.class ?? null,
              elementText: e.element?.text
                ? String(e.element.text).slice(0, 120)
                : null,
              elementHref: e.element?.href ?? null,
            },
          }),
        );

        sessionEventDelta.set(
          e.sessionId,
          (sessionEventDelta.get(e.sessionId) ?? 0) + 1,
        );
      }
    }

    // BUG FIX #2: build counter-update ops for sessions and visitors.
    for (const [sid, delta] of sessionPageViewDelta) {
      const existingCount = sessionPageViewSnapshot.get(sid) ?? 0;
      const isFirstEver = existingCount === 0;
      const firstPath = sessionFirstPath.get(sid);

      ops.push(
        prisma.analyticsSession.update({
          where: { id: sid },
          data: {
            pageViewCount: { increment: delta },
            eventCount: { increment: sessionEventDelta.get(sid) ?? 0 },
            // BUG FIX #6 (batch): set entryPage if this session had no views before
            ...(isFirstEver && firstPath ? { entryPage: firstPath } : {}),
          },
        }),
      );
    }

    // Sessions that only received events (no pageviews) still need eventCount bumped.
    for (const [sid, delta] of sessionEventDelta) {
      if (!sessionPageViewDelta.has(sid)) {
        ops.push(
          prisma.analyticsSession.update({
            where: { id: sid },
            data: { eventCount: { increment: delta } },
          }),
        );
      }
    }

    for (const [vid, delta] of visitorPageViewDelta) {
      ops.push(
        prisma.analyticsVisitor.update({
          where: { id: vid },
          data: { pageViewCount: { increment: delta } },
        }),
      );
    }

    if (ops.length === 0)
      return sendSuccessResponse(res, 200, "Batch processed (nothing to write)");

    await prisma.$transaction(ops);

    return sendSuccessResponse(res, 200, "Batch processed", {
      written: ops.length,
    });
  } catch (err: any) {
    console.error("[trackBatch]", err);
    return sendErrorResponse(res, 500, "Batch failed");
  }
}