import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { randomUUID } from "crypto";
import XLSX from "xlsx";
import { parse } from "csv-parse/sync";

/**
 * GET /customers
 */

export async function getCustomerList(req: Request, res: Response) {
  try {
    // const adminUserId = req.user?.id;
    // if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

    // if (!req.user?.roles?.includes?.("ADMIN"))
    //   return sendErrorResponse(res, 403, "Admin access required");

    /* ── Pagination ── */
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const {
      search,
      isActive,
      city,
      state,
      customerCategory,
      businessCategory,
      tallySerial,
      fromJoiningDate,
      toJoiningDate,
      productName,
      hasActiveProduct,
      missingEmail,
      missingPhone,
      missingCompanyName,
      missingTallySerial,
    } = req.query as Record<string, string>;

    /* ────────────────────────────────────────────────
       Build WHERE using AND array so every condition
       is independent and nothing overwrites another.
    ──────────────────────────────────────────────── */
    const andConditions: any[] = [];

    /* ── isActive ── */
    if (isActive !== undefined) {
      andConditions.push({ isActive: isActive === "true" });
    }

    if (missingEmail === "true") {
      andConditions.push({
        OR: [{ email: null }, { email: "" }],
      });
    }

    if (missingPhone === "true") {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM "Customer"
    WHERE phones IS NULL
       OR phones::text = '[]'
  `;

      andConditions.push({
        id: { in: rows.length ? rows.map((r) => r.id) : ["__no_match__"] },
      });
    }

    if (missingCompanyName === "true") {
      andConditions.push({
        OR: [{ customerCompanyName: null }, { customerCompanyName: "" }],
      });
    }

    if (missingTallySerial === "true") {
      andConditions.push({
        OR: [{ tallySerial: null }, { tallySerial: "" }],
      });
    }

    /* ── Full-text search ──────────────────────────
       Split text vs numeric intent:
       • Pure digits (≥ 6 chars)  → search normalizedMobile (indexed)
       • Short / mixed            → search name + companyName + contactPerson + mobile
       Both branches are wrapped in OR so they don't clash with the
       AND conditions below.
    ─────────────────────────────────────────────── */
    if (search?.trim()) {
      const raw = search.trim();
      const normalized = raw.replace(/\D/g, "");
      const isPhone = /^\d+$/.test(raw) && normalized.length >= 6;

      if (isPhone) {
        // Fast indexed path for mobile lookups
        andConditions.push({
          OR: [
            { normalizedMobile: { contains: normalized } },
            { mobile: { contains: raw } },
          ],
        });
      } else {
        // Text search: names + company + mobile prefix
        const orBlock: any[] = [
          { name: { contains: raw, mode: "insensitive" } },
          { customerCompanyName: { contains: raw, mode: "insensitive" } },
          { contactPerson: { contains: raw, mode: "insensitive" } },
        ];
        // Also allow numeric substring within the text query
        if (normalized.length >= 4) {
          orBlock.push({ normalizedMobile: { contains: normalized } });
        }
        andConditions.push({ OR: orBlock });
      }
    }

    /* ── Structured field filters ──────────────────
       Use `contains` (not `equals`) for city / state
       so "surat" matches "Surat" and partial strings
       still return results from the searchable dropdown.
    ─────────────────────────────────────────────── */
    if (city)
      andConditions.push({ city: { contains: city, mode: "insensitive" } });
    if (state)
      andConditions.push({ state: { contains: state, mode: "insensitive" } });
    if (customerCategory)
      andConditions.push({ customerCategory: { equals: customerCategory } });
    if (businessCategory)
      andConditions.push({ businessCategory: { equals: businessCategory } });
    if (tallySerial)
      andConditions.push({
        tallySerial: { contains: tallySerial, mode: "insensitive" },
      });

    /* ── Joining date range ── */
    if (fromJoiningDate || toJoiningDate) {
      const joiningDateFilter: any = {};
      if (fromJoiningDate) joiningDateFilter.gte = new Date(fromJoiningDate);
      if (toJoiningDate) joiningDateFilter.lte = new Date(toJoiningDate);
      andConditions.push({ joiningDate: joiningDateFilter });
    }

    /* ── JSON product filters ──────────────────────
       Prisma's `array_contains` requires an exact sub-object
       match, which breaks on partial product names.

       Workaround: cast products JSON column to text and use
       ILIKE for a case-insensitive partial match via $queryRaw.
       We resolve matching IDs first, then inject { id: { in } }
       into the main query — keeping full Prisma pagination intact.
    ─────────────────────────────────────────────── */
    if (productName?.trim()) {
      const pattern = `%${productName.trim()}%`;

      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "Customer"
        WHERE products IS NOT NULL
          AND products::text ILIKE ${pattern}
      `;

      // If the JSON search returns no rows, force an empty result
      // rather than ignoring the filter and returning everything.
      andConditions.push({
        id: { in: rows.length > 0 ? rows.map((r) => r.id) : ["__no_match__"] },
      });
    }

    if (hasActiveProduct === "true") {
      // Customers whose active array is not empty
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "Customer"
        WHERE products IS NOT NULL
          AND jsonb_array_length((products->'active')::jsonb) > 0
      `;
      andConditions.push({
        id: { in: rows.length > 0 ? rows.map((r) => r.id) : ["__no_match__"] },
      });
    }

    /* ── Final where clause ── */
    const where = andConditions.length > 0 ? { AND: andConditions } : {};

    /* ── Query ─────────────────────────────────────
       Re-enable $transaction so count + findMany
       share the same snapshot and avoid a TOCTOU gap.
    ─────────────────────────────────────────────── */
    const [items, total] = await prisma.$transaction([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          customerCompanyName: true,
          mobile: true,
          email: true,
          city: true,
          state: true,
          customerCategory: true,
          businessCategory: true,
          tallySerial: true,
          tallyVersion: true,
          joiningDate: true,
          products: true,
          isActive: true,
          createdAt: true,
          _count: { select: { leads: true } },
          leads: true,
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Customers fetched", {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err: any) {
    console.error("Get customers error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch customers",
    );
  }
}

/**
 * GET /customers/:id
 */
export async function getCustomerDetails(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return sendErrorResponse(res, 400, "Customer id is required");

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        leads: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            source: true,
            type: true,
            status: true,
            productTitle: true,
            cost: true,
            createdAt: true,
            closedAt: true,
          },
        },
        quotations: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            quotationNumber: true,
            status: true,
            channel: true,
            grandTotal: true,
            subtotal: true,
            totalDiscount: true,
            totalTax: true,
            currency: true,
            subject: true,
            quotationDate: true,
            validUntil: true,
            sentAt: true,
            convertedAt: true,
            version: true,
            lineItems: true,
            createdAt: true,
            createdByAcc: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        createdByAcc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!customer) return sendErrorResponse(res, 404, "Customer not found");

    return sendSuccessResponse(res, 200, "Customer details fetched", customer);
  } catch (err: any) {
    console.error("Get customer details error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch customer details",
    );
  }
}

export async function createCustomer(req: Request, res: Response) {
  try {
    if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      name,
      customerCompanyName,
      contactPerson,
      mobile,
      email,
      city,
      state,
      joiningDate,
      customerCategory,
      businessCategory,
      tallySerial,
      tallyVersion,
      notes,
      product,
    } = req.body;

    if (!name || !mobile)
      return sendErrorResponse(res, 400, "Name and mobile required");

    const normalizedMobile = mobile.replace(/\D/g, "");

    const existing = await prisma.customer.findUnique({
      where: { normalizedMobile },
    });

    if (existing) return sendErrorResponse(res, 400, "Customer already exists");

    /* ─────────────
       Build Product JSON
    ───────────── */
    let productsJson: any = { active: [], history: [] };

    if (product?.title) {
      productsJson.active.push({
        id: product.id || crypto.randomUUID(),
        name: product.title,
        price: product.price ?? 0,
        status: "ACTIVE",
        addedAt: new Date(),
      });
    }

    const customer = await prisma.customer.create({
      data: {
        name,
        customerCompanyName,
        contactPerson,
        mobile,
        normalizedMobile,
        email,
        city,
        state,
        joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
        customerCategory,
        businessCategory,
        tallySerial,
        tallyVersion,
        notes,
        products: productsJson,
        createdBy: req.user.accountId,
      },
    });

    return sendSuccessResponse(res, 201, "Customer created", customer);
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function updateCustomer(req: Request, res: Response) {
  try {
    if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return sendErrorResponse(res, 404, "Customer not found");

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...req.body,
        normalizedMobile: req.body.mobile || req.body.normalizedMobile,
        joiningDate: req.body.joiningDate
          ? new Date(req.body.joiningDate)
          : undefined,
      },
    });

    return sendSuccessResponse(res, 200, "Customer updated", updated);
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function deleteCustomer(req: Request, res: Response) {
  try {
    if (!req.user?.id) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return sendErrorResponse(res, 404, "Customer not found");

    await prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });

    return sendSuccessResponse(res, 200, "Customer deleted");
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function addCustomerProduct(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { name, price, purchaseAt } = req.body;

    if (!name || !price)
      return sendErrorResponse(res, 400, "Product name & price required");

    let normalizedPurchaseAt: string | null = null;
    if (purchaseAt) {
      const d = new Date(purchaseAt);
      if (isNaN(d.getTime()))
        return sendErrorResponse(res, 400, "Invalid purchaseAt date");
      if (d > new Date())
        return sendErrorResponse(
          res,
          400,
          "purchaseAt cannot be a future date",
        );
      normalizedPurchaseAt = d.toISOString();
    }

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return sendErrorResponse(res, 404, "Customer not found");

    let existingProducts: any = customer.products;
    if (typeof existingProducts !== "object" || existingProducts === null) {
      existingProducts = { active: [], history: [] };
    }

    const newProduct = {
      id: randomUUID(),
      name,
      price,
      status: "ACTIVE",
      addedAt: new Date().toISOString(),
      purchaseAt: normalizedPurchaseAt,
    };

    if (!Array.isArray(existingProducts.active)) existingProducts.active = [];

    existingProducts.active.push(newProduct);

    await prisma.customer.update({
      where: { id },
      data: { products: existingProducts },
    });

    return sendSuccessResponse(res, 200, "Product added", newProduct);
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function expireCustomerProduct(req: Request, res: Response) {
  try {
    const { id, productId } = req.params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return sendErrorResponse(res, 404, "Customer not found");

    // Prisma returns JSON as JsonValue (string | number | boolean | JsonObject | JsonArray)
    // so ensure we treat it as an object with active/history arrays before accessing .active
    const productsRaw = customer.products;
    const products =
      typeof productsRaw === "object" && productsRaw !== null
        ? (productsRaw as any)
        : { active: [], history: [] };

    if (!Array.isArray(products.active)) products.active = [];

    const index = products.active.findIndex((p: any) => p.id === productId);
    if (index === -1) return sendErrorResponse(res, 404, "Product not found");

    const [product] = products.active.splice(index, 1);

    product.status = "EXPIRED";
    product.expiredAt = new Date();

    if (!Array.isArray(products.history)) products.history = [];
    products.history.push(product);

    await prisma.customer.update({
      where: { id },
      data: { products },
    });

    return sendSuccessResponse(res, 200, "Product expired");
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

/**
 * DELETE /admin/customers/:id/permanent
 * Hard delete customer with all related leads
 */
export async function deleteCustomerPermanentAdmin(
  req: Request,
  res: Response,
) {
  try {
    const { id } = req.params;

    const existing = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        leads: { select: { id: true } },
      },
    });

    if (!existing) {
      return sendErrorResponse(res, 404, "Customer not found");
    }

    await prisma.$transaction(async (tx) => {
      const leadIds = existing.leads.map((l) => l.id);

      if (leadIds.length > 0) {
        await tx.leadActivityLog.deleteMany({
          where: { leadId: { in: leadIds } },
        });

        await tx.leadAssignment.deleteMany({
          where: { leadId: { in: leadIds } },
        });

        await tx.leadHelper.deleteMany({
          where: { leadId: { in: leadIds } },
        });

        await tx.lead.deleteMany({
          where: { id: { in: leadIds } },
        });
      }

      await tx.customer.delete({
        where: { id },
      });
    });

    return sendSuccessResponse(
      res,
      200,
      "Customer permanently deleted with related leads",
    );
  } catch (err: any) {
    console.error("Delete customer error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete customer",
    );
  }
}

/**
 * DELETE /admin/customers/:customerId/products/:productId
 * Permanently remove a single product from the customer's active products JSON
 */
export async function removeCustomerProductAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { customerId, productId } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, products: true },
    });
    if (!customer) return sendErrorResponse(res, 404, "Customer not found");

    const products = (customer.products ?? { active: [], history: [] }) as {
      active: any[];
      history: any[];
    };

    if (!Array.isArray(products.active))
      return sendErrorResponse(res, 400, "Invalid products structure");

    const targetIndex = products.active.findIndex((p) => p.id === productId);
    if (targetIndex === -1) {
      const h_targetIndex = products.history.findIndex(
        (p) => p.id === productId,
      );
      products.history.splice(h_targetIndex, 1);
      // return sendErrorResponse(res, 404, "Product not found in active list");
    }

    products.active.splice(targetIndex, 1);

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        products,
        updatedAt: new Date(),
      },
    });

    return sendSuccessResponse(res, 200, "Product removed successfully", {
      customerId,
      productId,
    });
  } catch (err: any) {
    console.error("Remove customer product error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to remove product",
    );
  }
}


// ─── helpers (same as existing) ───────────────────────────────
function normalizeKeys(obj: any) {
  const newObj: any = {};
  Object.keys(obj).forEach((key) => {
    newObj[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = obj[key];
  });
  return newObj;
}

function normalizeMobile(mobile: string) {
  return String(mobile)
    .replace(/[\s\-\.]/g, "")
    .replace(/^\+/, "")
    .replace(/^91(\d{10})$/, "$1")
    .replace(/^0(\d{10})$/, "$1")
    .replace(/\D/g, "")
    .slice(0, 10);
}

function isValidEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

function normalizeTallyVersion(value: any): string | null {
  if (!value) return null;

  const v = String(value).trim().toLowerCase();

  const map: Record<string, string> = {
    silver: "Tally Prime Silver",
    gold: "Tally Prime Gold",
    auditor: "Tally Auditor",

    // also support already-correct values
    "tally prime silver": "Tally Prime Silver",
    "tally prime gold": "Tally Prime Gold",
    "tally auditor": "Tally Auditor",
  };

  return map[v] || null; // return null if unknown
}

function parseExcelDate(value: any): string | null {
  if (!value) return null;

  // Case 1: Excel numeric date (like 44826)
  if (!isNaN(value)) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + Number(value) * 86400000);
    return date.toISOString().split("T")[0];
  }

  const str = String(value).trim();

  // Case 2: DD-MMM-YYYY (22-Sep-2022)
  const match = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (match) {
    const [, day, monStr, year] = match;

    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };

    const month = months[monStr.toLowerCase()];
    if (month === undefined) return null;

    const date = new Date(Number(year), month, Number(day));
    return date.toISOString().split("T")[0];
  }

  // Case 3: fallback (ISO or others)
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }

  return null;
}

function parseRowToCustomer(rawRow: any) {
  const r = normalizeKeys(rawRow);

  const name =
    r.name || r.customername || r.clientname || r.partyname ||
    r.accountname || r.contactperson || "";

  const mobileRaw = r.mobile || r.mobileno || r.phone || "";
  const mobile = String(mobileRaw).trim();
  const normalizedMobile = normalizeMobile(mobile);

  const productRaw = rawRow["Product Name"] || rawRow["product name"] || r.productname || "";
  const products: string[] = productRaw
    ? Array.from(new Set(
      String(productRaw).split(",").map((p: string) => p.trim()).filter(Boolean)
    ))
    : [];

  return {
    name: String(name).trim(),
    mobile,
    normalizedMobile,
    email: r.email || null,
    customerCompanyName: r.customercompanyname || r.companyname || null,
    contactPerson: r.contactperson || null,
    city: r.city || null,
    state: r.state || null,
    joiningDate: parseExcelDate(r.joiningdate),
    customerCategory: r.customercategory || null,
    businessCategory: r.businesscategory || null,
    tallySerial: r.tallyserial != null ? String(r.tallyserial) : null,
    tallyVersion: normalizeTallyVersion(r.tallyversion),
    products,
    notes: r.notes || null,
  };
}

type RowStatus = "valid" | "error" | "warning" | "duplicate_file" | "duplicate_db";

interface VerifiedRow {
  rowIndex: number;          // 1-based for display
  raw: Record<string, any>;  // original row from file
  parsed: ReturnType<typeof parseRowToCustomer>;
  status: RowStatus;
  errors: string[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────
// POST /customers/bulk/verify
// Body: { rows: any[] }  OR multipart file
// Returns full per-row verification result
// ─────────────────────────────────────────────────────────────
export async function verifyBulkCustomers(req: Request, res: Response) {
  try {
    let rows: any[] = [];

    // Accept either JSON body rows OR uploaded file
    if (req.file) {
      if (req.file.originalname.endsWith(".xlsx")) {
        const wb = XLSX.read(req.file.buffer, { type: "buffer" });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      } else if (req.file.originalname.endsWith(".csv")) {
        rows = parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true });
      } else {
        return sendErrorResponse(res, 400, "Only .xlsx or .csv files are accepted");
      }
    } else if (Array.isArray(req.body?.rows)) {
      rows = req.body.rows;
    } else {
      return sendErrorResponse(res, 400, "Provide a file or rows array");
    }

    if (!rows.length) return sendErrorResponse(res, 400, "No data found");

    // 1. Parse all rows
    const parsed = rows.map((raw, i) => ({
      rowIndex: i + 2, // +2 = header row + 1-based
      raw,
      parsed: parseRowToCustomer(raw),
    }));

    // 2. Collect all valid mobiles for DB check
    const validMobiles = parsed
      .map((r) => r.parsed.normalizedMobile)
      .filter((m) => m && m.length >= 10);

    const existingInDB = await prisma.customer.findMany({
      where: { normalizedMobile: { in: validMobiles } },
      select: { normalizedMobile: true, name: true, id: true },
    });
    const dbMobileSet = new Map(existingInDB.map((e) => [e.normalizedMobile, e]));

    // 3. Build verified rows with per-row errors/warnings
    const seenInFile = new Map<string, number>(); // mobile -> first rowIndex
    const verified: VerifiedRow[] = parsed.map(({ rowIndex, raw, parsed: p }) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      let status: RowStatus = "valid";

      // Required fields
      if (!p.name) errors.push("Name is missing");
      if (!p.mobile) {
        errors.push("Mobile number is missing");
      } else if (p.normalizedMobile.length < 10) {
        errors.push(`Mobile "${p.mobile}" is invalid (need 10 digits)`);
      }

      // Format checks (warnings only)
      if (p.email && !isValidEmail(p.email)) warnings.push(`Email "${p.email}" looks invalid`);

      const parsedDate = parseExcelDate(p.joiningDate);

      if (p.joiningDate && !parsedDate) {
        warnings.push(`Joining date "${p.joiningDate}" couldn't be parsed`);
      }
      if (!p.customerCompanyName) warnings.push("Company name is empty");
      if (!p.tallySerial) warnings.push("Tally serial is empty");

      // Duplicates within file
      if (p.normalizedMobile && p.normalizedMobile.length >= 10) {
        if (seenInFile.has(p.normalizedMobile)) {
          errors.push(`Duplicate mobile in file (same as row ${seenInFile.get(p.normalizedMobile)})`);
          status = "duplicate_file";
        } else {
          seenInFile.set(p.normalizedMobile, rowIndex);
        }

        // Duplicate in DB
        if (status !== "duplicate_file" && dbMobileSet.has(p.normalizedMobile)) {
          const existing = dbMobileSet.get(p.normalizedMobile)!;
          errors.push(`Already exists in database (customer: ${existing.name})`);
          status = "duplicate_db";
        }
      }

      if (errors.length && status === "valid") status = "error";
      else if (!errors.length && warnings.length && status === "valid") status = "warning";

      return { rowIndex, raw, parsed: p, status, errors, warnings };
    });

    const stats = {
      total: verified.length,
      valid: verified.filter((r) => r.status === "valid").length,
      warnings: verified.filter((r) => r.status === "warning").length,
      errors: verified.filter((r) => r.status === "error").length,
      duplicateInFile: verified.filter((r) => r.status === "duplicate_file").length,
      duplicateInDB: verified.filter((r) => r.status === "duplicate_db").length,
    };

    return sendSuccessResponse(res, 200, "Verification complete", { stats, rows: verified });
  } catch (err: any) {
    console.error("verifyBulkCustomers error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Verification failed");
  }
}

// ─────────────────────────────────────────────────────────────
// POST /customers/bulk/import
// Body: { rows: CorrectedRow[] }
// Each row is the parsed+corrected customer data (NOT raw file rows).
// Skips rows with status error/duplicate.
// ─────────────────────────────────────────────────────────────
export async function bulkImportCustomers(req: Request, res: Response) {
  try {
    if (!req.user?.accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { rows } = req.body as {
      rows: {
        name: string;
        mobile: string;
        normalizedMobile: string;
        email?: string | null;
        customerCompanyName?: string | null;
        contactPerson?: string | null;
        city?: string | null;
        state?: string | null;
        joiningDate?: string | null;
        customerCategory?: string | null;
        businessCategory?: string | null;
        tallySerial?: string | null;
        tallyVersion?: string | null;
        products?: string[];
        notes?: string | null;
      }[];
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      return sendErrorResponse(res, 400, "No rows to import");
    }

    // Re-validate mobiles and deduplicate
    const validRows = rows.filter(
      (r) => r.name?.trim() && r.normalizedMobile && r.normalizedMobile.length >= 10
    );

    const uniqueMap = new Map<string, typeof validRows[0]>();
    validRows.forEach((r) => {
      if (!uniqueMap.has(r.normalizedMobile)) uniqueMap.set(r.normalizedMobile, r);
    });
    const unique = Array.from(uniqueMap.values());

    // Check DB duplicates one more time (safety net)
    const mobiles = unique.map((r) => r.normalizedMobile);
    const existing = await prisma.customer.findMany({
      where: { normalizedMobile: { in: mobiles } },
      select: { normalizedMobile: true },
    });
    const existingSet = new Set(existing.map((e) => e.normalizedMobile));

    const toCreate = unique.filter((r) => !existingSet.has(r.normalizedMobile));

    const finalData = toCreate.map((r) => ({
      name: r.name.trim(),
      mobile: r.mobile,
      normalizedMobile: r.normalizedMobile,
      email: r.email || null,
      customerCompanyName: r.customerCompanyName || null,
      contactPerson: r.contactPerson || null,
      city: r.city || null,
      state: r.state || null,
      joiningDate: r.joiningDate ? new Date(r.joiningDate) : new Date(),
      customerCategory: r.customerCategory || null,
      businessCategory: r.businessCategory || null,
      tallySerial: r.tallySerial || null,
      tallyVersion: r.tallyVersion || null,
      notes: r.notes || null,
      products: r.products?.length
        ? {
          active: r.products.map((name) => ({
            id: randomUUID(),
            name,
            price: 0,
            status: "ACTIVE",
            addedAt: new Date(),
          })),
          history: [],
        }
        : undefined,
      createdBy: req.user!.accountId,
    }));

    await prisma.customer.createMany({ data: finalData, skipDuplicates: true });

    return sendSuccessResponse(res, 201, "Import complete", {
      submitted: rows.length,
      imported: finalData.length,
      skippedDuplicates: existingSet.size,
      skippedInvalid: rows.length - validRows.length,
    });
  } catch (err: any) {
    console.error("bulkImportCustomers error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Import failed");
  }
}
