// src/controller/public/customerPortal.controller.ts

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { logCustomerPortalAudit } from "../../core/middleware/auth/customerPortalAuth";

/**
 * GET /api/v1/public/portal/session
 * Return customer summary, active products count, open tickets count, pending quotations count
 */
export async function getPortalSession(req: Request, res: Response) {
  try {
    const customerId = req.customer.id;

    const [activeProductsCount, openTicketsCount, pendingQuotationsCount, leadsCount] =
      await Promise.all([
        prisma.customerProduct.count({
          where: { customerId, isActive: true },
        }),
        prisma.support.count({
          where: { customerId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        }),
        prisma.quotation.count({
          where: { customerId, status: { in: ["SENT", "VIEWED"] } },
        }),
        prisma.lead.count({
          where: { customerId },
        }),
      ]);

    await logCustomerPortalAudit(customerId, "SESSION_START", req);

    return res.json({
      success: true,
      data: {
        customer: {
          id: req.customer.id,
          name: req.customer.name,
          customerCompanyName: req.customer.customerCompanyName,
          contactPerson: req.customer.contactPerson,
          mobile: req.customer.mobile,
          email: req.customer.email,
          city: req.customer.city,
          state: req.customer.state,
          customerCategory: req.customer.customerCategory,
          businessCategory: req.customer.businessCategory,
          tallySerial: req.customer.tallySerial,
          tallyVersion: req.customer.tallyVersion,
        },
        counts: {
          activeProducts: activeProductsCount,
          openTickets: openTicketsCount,
          pendingQuotations: pendingQuotationsCount,
          inquiries: leadsCount,
        },
      },
    });
  } catch (error) {
    console.error("[getPortalSession] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load portal session" });
  }
}

/**
 * GET /api/v1/public/portal/profile
 */
export async function getPortalProfile(req: Request, res: Response) {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.customer.id },
      select: {
        id: true,
        name: true,
        customerCompanyName: true,
        contactPerson: true,
        mobile: true,
        email: true,
        emails: true,
        phones: true,
        city: true,
        state: true,
        customerCategory: true,
        businessCategory: true,
        joiningDate: true,
        tallySerial: true,
        tallyVersion: true,
        isActive: true,
        createdAt: true,
      },
    });

    await logCustomerPortalAudit(req.customer.id, "VIEW_PROFILE", req);

    return res.json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error("[getPortalProfile] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
}

/**
 * PATCH /api/v1/public/portal/profile
 */
export async function updatePortalProfile(req: Request, res: Response) {
  try {
    const { contactPerson, email, city, state, phones, emails } = req.body;

    const updatedCustomer = await prisma.customer.update({
      where: { id: req.customer.id },
      data: {
        ...(contactPerson !== undefined && { contactPerson }),
        ...(email !== undefined && { email }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(phones !== undefined && { phones }),
        ...(emails !== undefined && { emails }),
      },
    });

    await logCustomerPortalAudit(req.customer.id, "UPDATE_PROFILE", req, {
      updatedFields: Object.keys(req.body),
    });

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: updatedCustomer,
    });
  } catch (error) {
    console.error("[updatePortalProfile] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update profile" });
  }
}

/**
 * GET /api/v1/public/portal/products
 */
export async function getPortalProducts(req: Request, res: Response) {
  try {
    const customerId = req.customer.id;

    const customerProducts = await prisma.customerProduct.findMany({
      where: { customerId },
      include: {
        productCatalog: {
          select: {
            id: true,
            title: true,
            slug: true,
            pricingModel: true,
            shortDesc: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    await logCustomerPortalAudit(customerId, "VIEW_PRODUCTS", req);

    return res.json({
      success: true,
      data: {
        products: customerProducts,
        legacyProductsJson: req.customer.products,
      },
    });
  } catch (error) {
    console.error("[getPortalProducts] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch products" });
  }
}

/**
 * GET /api/v1/public/portal/quotations
 */
export async function getPortalQuotations(req: Request, res: Response) {
  try {
    const customerId = req.customer.id;
    const { status } = req.query;

    const quotations = await prisma.quotation.findMany({
      where: {
        customerId,
        ...(status && typeof status === "string" && { status: status.toUpperCase() as any }),
      },
      include: {
        lineItems: true,
      },
      orderBy: { createdAt: "desc" },
    });

    await logCustomerPortalAudit(customerId, "VIEW_QUOTATIONS", req);

    return res.json({
      success: true,
      data: quotations,
    });
  } catch (error) {
    console.error("[getPortalQuotations] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch quotations" });
  }
}

/**
 * GET /api/v1/public/portal/quotations/:id
 */
export async function getPortalQuotationById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;

    const quotation = await prisma.quotation.findFirst({
      where: { id, customerId },
      include: {
        lineItems: {
          include: {
            productCatalog: true,
          },
        },
        activities: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!quotation) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }

    await logCustomerPortalAudit(customerId, "VIEW_QUOTATION_DETAIL", req, { quotationId: id });

    return res.json({
      success: true,
      data: quotation,
    });
  } catch (error) {
    console.error("[getPortalQuotationById] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch quotation details" });
  }
}

/**
 * POST /api/v1/public/portal/quotations/:id/accept
 */
export async function acceptPortalQuotation(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;
    const { acceptedBy, acceptanceNote } = req.body;

    const quotation = await prisma.quotation.findFirst({
      where: { id, customerId },
    });

    if (!quotation) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }

    if (quotation.status === "ACCEPTED") {
      return res.status(400).json({ success: false, message: "Quotation is already accepted" });
    }

    const updated = await prisma.quotation.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
        acceptedBy: acceptedBy || req.customer.contactPerson || req.customer.name,
        acceptanceNote: acceptanceNote,
      },
    });

    await prisma.quotationActivity.create({
      data: {
        quotationId: id,
        action: "ACCEPTED",
        meta: {
          note: `Accepted by customer via portal${acceptanceNote ? `: ${acceptanceNote}` : ""}`,
        },
      },
    });

    await logCustomerPortalAudit(customerId, "ACCEPT_QUOTATION", req, { quotationId: id });

    return res.json({
      success: true,
      message: "Quotation accepted successfully",
      data: updated,
    });
  } catch (error) {
    console.error("[acceptPortalQuotation] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to accept quotation" });
  }
}

/**
 * POST /api/v1/public/portal/quotations/:id/reject
 */
export async function rejectPortalQuotation(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;
    const { rejectionReason } = req.body;

    const quotation = await prisma.quotation.findFirst({
      where: { id, customerId },
    });

    if (!quotation) {
      return res.status(404).json({ success: false, message: "Quotation not found" });
    }

    const updated = await prisma.quotation.update({
      where: { id },
      data: {
        status: "REJECTED",
        respondedAt: new Date(),
        rejectionReason: rejectionReason || "Rejected via Customer Portal",
      },
    });

    await prisma.quotationActivity.create({
      data: {
        quotationId: id,
        action: "REJECTED",
        meta: {
          note: `Rejected by customer: ${rejectionReason || "No reason specified"}`,
        },
      },
    });

    await logCustomerPortalAudit(customerId, "REJECT_QUOTATION", req, { quotationId: id, rejectionReason });

    return res.json({
      success: true,
      message: "Quotation status updated to rejected",
      data: updated,
    });
  } catch (error) {
    console.error("[rejectPortalQuotation] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to reject quotation" });
  }
}

/**
 * GET /api/v1/public/portal/supports
 */
export async function getPortalSupports(req: Request, res: Response) {
  try {
    const customerId = req.customer.id;
    const { status } = req.query;

    const supports = await prisma.support.findMany({
      where: {
        customerId,
        ...(status && typeof status === "string" && { status: status.toUpperCase() as any }),
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    await logCustomerPortalAudit(customerId, "VIEW_SUPPORTS", req);

    return res.json({
      success: true,
      data: supports,
    });
  } catch (error) {
    console.error("[getPortalSupports] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch support tickets" });
  }
}

/**
 * GET /api/v1/public/portal/supports/:id
 */
export async function getPortalSupportById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;

    const support = await prisma.support.findFirst({
      where: { id, customerId },
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                avatar: true,
              },
            },
          },
        },
        activityLogs: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!support) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    await logCustomerPortalAudit(customerId, "VIEW_SUPPORT_DETAIL", req, { supportId: id });

    return res.json({
      success: true,
      data: support,
    });
  } catch (error) {
    console.error("[getPortalSupportById] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch support details" });
  }
}

/**
 * POST /api/v1/public/portal/supports
 * Create a new Support Ticket in CRM
 */
export async function createPortalSupport(req: Request, res: Response) {
  try {
    const customerId = req.customer.id;
    const { subject, description, priority, type, productCatalogId } = req.body;

    if (!subject || !subject.trim()) {
      return res.status(400).json({ success: false, message: "Subject is required" });
    }

    const validTypes = [
      "TECHNICAL_ISSUE",
      "PRODUCT_TRAINING",
      "FEATURE_EXPLANATION",
      "NEW_SETUP",
      "INSTALLATION",
      "CONFIGURATION",
      "BUG_REPORT",
      "MAINTENANCE",
      "FOLLOW_UP",
      "CONSULTATION",
      "OTHER",
    ];

    let supportType: any = "TECHNICAL_ISSUE";
    if (type && typeof type === "string") {
      const normalizedType = type.toUpperCase();
      if (validTypes.includes(normalizedType)) {
        supportType = normalizedType;
      } else if (normalizedType === "ISSUE") {
        supportType = "TECHNICAL_ISSUE";
      } else if (normalizedType === "QUERY") {
        supportType = "FEATURE_EXPLANATION";
      } else if (normalizedType === "CUSTOMIZATION") {
        supportType = "CONFIGURATION";
      }
    }

    const support = await prisma.support.create({
      data: {
        subject: subject.trim(),
        description: description?.trim() || null,
        priority: priority ? (priority.toUpperCase() as any) : "MEDIUM",
        type: supportType,
        status: "OPEN",
        customerId,
        ...(productCatalogId && { productCatalogId }),
        remarks: [
          {
            id: `rmk_${Date.now()}`,
            text: `Support request created by customer (${req.customer.contactPerson || req.customer.name})`,
            by: {
              name: req.customer.contactPerson || req.customer.name,
              isCustomer: true,
            },
            at: new Date().toISOString(),
          },
        ],
      },
    });

    await prisma.supportActivityLog.create({
      data: {
        supportId: support.id,
        action: "CREATED",
        meta: { source: "CUSTOMER_PORTAL", createdByCustomer: req.customer.name },
      },
    });

    await logCustomerPortalAudit(customerId, "CREATE_SUPPORT", req, { supportId: support.id });

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: support,
    });
  } catch (error) {
    console.error("[createPortalSupport] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create support ticket" });
  }
}

/**
 * POST /api/v1/public/portal/supports/:id/remarks
 * Customer posts a reply/remark on a ticket
 */
export async function addPortalSupportRemark(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const customerId = req.customer.id;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Message text is required" });
    }

    const support = await prisma.support.findFirst({
      where: { id, customerId },
    });

    if (!support) {
      return res.status(404).json({ success: false, message: "Support ticket not found" });
    }

    const existingRemarks = Array.isArray(support.remarks) ? support.remarks : [];
    const newRemark = {
      id: `rmk_${Date.now()}`,
      text: text.trim(),
      by: {
        name: req.customer.contactPerson || req.customer.name,
        isCustomer: true,
      },
      at: new Date().toISOString(),
    };

    const updated = await prisma.support.update({
      where: { id },
      data: {
        remarks: [...existingRemarks, newRemark],
        status: support.status === "SUPPORT_DONE" ? "OPEN" : support.status,
      },
    });

    await prisma.supportActivityLog.create({
      data: {
        supportId: id,
        action: "REMARK_ADDED",
        meta: { text: text.trim(), byCustomer: true },
      },
    });

    await logCustomerPortalAudit(customerId, "ADD_SUPPORT_REMARK", req, { supportId: id });

    return res.json({
      success: true,
      message: "Remark added successfully",
      data: updated,
    });
  } catch (error) {
    console.error("[addPortalSupportRemark] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add remark" });
  }
}

/**
 * GET /api/v1/public/portal/leads
 * Fetch customer inquiry history
 */
export async function getPortalLeads(req: Request, res: Response) {
  try {
    const customerId = req.customer.id;

    const leads = await prisma.lead.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    await logCustomerPortalAudit(customerId, "VIEW_LEADS", req);

    return res.json({
      success: true,
      data: leads,
    });
  } catch (error) {
    console.error("[getPortalLeads] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch inquiry history" });
  }
}

/**
 * POST /api/v1/public/portal/leads
 * Submit a Product Inquiry (creates a Lead in CRM)
 */
export async function createPortalLead(req: Request, res: Response) {
  try {
    const customerId = req.customer.id;
    const { title, requirements, budget } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Inquiry title is required" });
    }

    const lead = await prisma.lead.create({
      data: {
        customerName: req.customer.contactPerson || req.customer.name,
        mobileNumber: req.customer.mobile,
        customerCompanyName: req.customer.customerCompanyName || req.customer.name,
        productTitle: title.trim(),
        remark: requirements?.trim() || null,
        cost: budget ? parseFloat(budget) : null,
        customerId,
        source: "INQUIRY_FORM",
        type: "LEAD",
        status: "PENDING",
      },
    });

    await prisma.leadActivityLog.create({
      data: {
        leadId: lead.id,
        action: "CREATED",
        meta: { source: "CUSTOMER_PORTAL", createdByCustomer: req.customer.name },
      },
    });

    await logCustomerPortalAudit(customerId, "SUBMIT_INQUIRY", req, { leadId: lead.id });

    return res.status(201).json({
      success: true,
      message: "Product inquiry submitted successfully",
      data: lead,
    });
  } catch (error) {
    console.error("[createPortalLead] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit inquiry" });
  }
}
/**
 * GET /api/v1/public/portal/notifications
 */
export async function getPortalNotifications(req: Request, res: Response) {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        OR: [
          { customerId: req.customer.id },
          {
            customerId: null,
            forCustomer: true,
          },
        ],
      },
      take: 20,
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    console.error("[getPortalNotifications] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
}
/**
 * POST /api/v1/public/portal/login
 * Log in using 5-digit portalId and 4-digit pin.
 * Returns the raw token.
 */
export async function portalLogin(req: Request, res: Response) {
  try {
    const { portalId, pin } = req.body;

    if (!portalId || !pin) {
      return res.status(400).json({ success: false, message: "Portal ID and PIN are required" });
    }

    const portalToken = await prisma.customerPortalToken.findUnique({
      where: { portalId },
      include: { customer: true }
    });

    if (!portalToken || !portalToken.isActive || !portalToken.customer.isActive) {
      return res.status(401).json({ success: false, message: "Invalid Portal ID or Inactive account" });
    }

    if (portalToken.pin !== pin) {
      return res.status(401).json({ success: false, message: "Incorrect PIN" });
    }

    // Check expiration if set
    if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
      return res.status(401).json({ success: false, message: "Access expired. Please contact support." });
    }

    // Update lastAccessedAt and accessCount
    await prisma.customerPortalToken.update({
      where: { id: portalToken.id },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    });

    await logCustomerPortalAudit(portalToken.customerId, "SESSION_START", req, { loginMethod: "ID_PIN" });

    return res.json({
      success: true,
      message: "Authentication successful",
      data: {
        token: portalToken.rawToken || "",
      }
    });
  } catch (error) {
    console.error("[portalLogin] Error:", error);
    return res.status(500).json({ success: false, message: "Authentication failed" });
  }
}

/**
 * PATCH /api/v1/public/portal/update-pin
 * Update the 4-digit PIN using old PIN and new PIN.
 */
export async function updatePortalPin(req: Request, res: Response) {
  try {
    const { oldPin, newPin } = req.body;
    const portalToken = req.customerToken; // Attached by verifyCustomerPortalToken middleware

    if (!oldPin || !newPin) {
      return res.status(400).json({ success: false, message: "Old PIN and New PIN are required" });
    }

    if (newPin.length !== 4 || isNaN(Number(newPin))) {
      return res.status(400).json({ success: false, message: "New PIN must be exactly 4 digits" });
    }

    if (portalToken.pin !== oldPin) {
      return res.status(400).json({ success: false, message: "Incorrect Old PIN" });
    }

    await prisma.customerPortalToken.update({
      where: { id: portalToken.id },
      data: { pin: newPin },
    });

    await logCustomerPortalAudit(portalToken.customerId, "UPDATE_PIN", req);

    return res.json({
      success: true,
      message: "PIN updated successfully"
    });
  } catch (error) {
    console.error("[updatePortalPin] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update PIN" });
  }
}

