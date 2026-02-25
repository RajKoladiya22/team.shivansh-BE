import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { randomUUID } from "crypto";

/**
 * GET /customers
 */
// export async function getCustomerList(req: Request, res: Response) {
//   try {
//     // const adminUserId = req.user?.id;
//     // if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

//     // if (!req.user?.roles?.includes?.("ADMIN"))
//     //   return sendErrorResponse(res, 403, "Admin access required");

//     const page = Math.max(Number(req.query.page) || 1, 1);
//     const limit = Math.min(Number(req.query.limit) || 20, 100);
//     const skip = (page - 1) * limit;

//     const {
//       search,
//       isActive,
//       city,
//       state,
//       customerCategory,
//       businessCategory,
//       tallySerial,
//       fromJoiningDate,
//       toJoiningDate,
//       productName,
//       hasActiveProduct,
//     } = req.query as Record<string, string>;

//     const where: any = {};

//     // Active filter
//     if (isActive !== undefined) {
//       where.isActive = isActive === "true";
//     }

//     // Search
//     if (search) {
//       const normalized = search.replace(/\D/g, "");
//       where.OR = [
//         { name: { contains: search, mode: "insensitive" } },
//         { mobile: { contains: search } },
//         { normalizedMobile: { contains: normalized } },
//         { customerCompanyName: { contains: search, mode: "insensitive" } },
//         { contactPerson: { contains: search, mode: "insensitive" } },
//       ];
//     }

//     // Structured filters
//     if (city) where.city = { equals: city, mode: "insensitive" };
//     if (state) where.state = { equals: state, mode: "insensitive" };
//     if (customerCategory) where.customerCategory = { equals: customerCategory };
//     if (businessCategory) where.businessCategory = { equals: businessCategory };
//     if (tallySerial)
//       where.tallySerial = { contains: tallySerial, mode: "insensitive" };

//     // Joining date range
//     if (fromJoiningDate || toJoiningDate) {
//       where.joiningDate = {};
//       if (fromJoiningDate) where.joiningDate.gte = new Date(fromJoiningDate);
//       if (toJoiningDate) where.joiningDate.lte = new Date(toJoiningDate);
//     }

//     // JSON Product Filters (Postgres JSON path)
//     if (productName) {
//       where.products = {
//         path: ["active"],
//         array_contains: [
//           {
//             name: productName,
//           },
//         ],
//       };
//     }

//     if (hasActiveProduct === "true") {
//       where.products = {
//         path: ["active"],
//         not: [],
//       };
//     }

//     // const [items, total] = await prisma.$transaction([
//     //   prisma.customer.findMany({
//     //     where,
//     //     skip,
//     //     take: limit,
//     //     orderBy: { createdAt: "desc" },
//     //     select: {
//     //       id: true,
//     //       name: true,
//     //       customerCompanyName: true,
//     //       mobile: true,
//     //       email: true,
//     //       city: true,
//     //       state: true,
//     //       customerCategory: true,
//     //       businessCategory: true,
//     //       tallySerial: true,
//     //       joiningDate: true,
//     //       products: true,
//     //       isActive: true,
//     //       createdAt: true,
//     //       _count: {
//     //         select: { leads: true },
//     //       },
//     //     },
//     //   }),
//     //   prisma.customer.count({ where }),
//     // ]);
//     const items = await prisma.customer.findMany({
//       where,
//       skip,
//       take: limit,
//       orderBy: { createdAt: "desc" },
//       select: {
//         id: true,
//         name: true,
//         customerCompanyName: true,
//         mobile: true,
//         email: true,
//         city: true,
//         state: true,
//         customerCategory: true,
//         businessCategory: true,
//         tallySerial: true,
//         joiningDate: true,
//         products: true,
//         isActive: true,
//         createdAt: true,
//         _count: {
//           select: { leads: true },
//         },
//       },
//     });

//     const total = await prisma.customer.count({ where });

//     return sendSuccessResponse(res, 200, "Customers fetched", {
//       page,
//       limit,
//       total,
//       pages: Math.ceil(total / limit),
//       items,
//     });
//   } catch (err: any) {
//     console.error("Get customers error:", err);
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to fetch customers",
//     );
//   }
// }

export async function getCustomerList(req: Request, res: Response) {
  try {
    // const adminUserId = req.user?.id;
    // if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

    // if (!req.user?.roles?.includes?.("ADMIN"))
    //   return sendErrorResponse(res, 403, "Admin access required");

    /* ── Pagination ── */
    const page  = Math.max(Number(req.query.page)  || 1,   1);
    const limit = Math.min(Number(req.query.limit)  || 20, 100);
    const skip  = (page - 1) * limit;

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

    /* ── Full-text search ──────────────────────────
       Split text vs numeric intent:
       • Pure digits (≥ 6 chars)  → search normalizedMobile (indexed)
       • Short / mixed            → search name + companyName + contactPerson + mobile
       Both branches are wrapped in OR so they don't clash with the
       AND conditions below.
    ─────────────────────────────────────────────── */
    if (search?.trim()) {
      const raw        = search.trim();
      const normalized = raw.replace(/\D/g, "");
      const isPhone    = /^\d+$/.test(raw) && normalized.length >= 6;

      if (isPhone) {
        // Fast indexed path for mobile lookups
        andConditions.push({
          OR: [
            { normalizedMobile: { contains: normalized } },
            { mobile:           { contains: raw       } },
          ],
        });
      } else {
        // Text search: names + company + mobile prefix
        const orBlock: any[] = [
          { name:                { contains: raw, mode: "insensitive" } },
          { customerCompanyName: { contains: raw, mode: "insensitive" } },
          { contactPerson:       { contains: raw, mode: "insensitive" } },
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
    if (city)             andConditions.push({ city:             { contains: city,             mode: "insensitive" } });
    if (state)            andConditions.push({ state:            { contains: state,            mode: "insensitive" } });
    if (customerCategory) andConditions.push({ customerCategory: { equals:   customerCategory  } });
    if (businessCategory) andConditions.push({ businessCategory: { equals:   businessCategory  } });
    if (tallySerial)      andConditions.push({ tallySerial:      { contains: tallySerial,      mode: "insensitive" } });

    /* ── Joining date range ── */
    if (fromJoiningDate || toJoiningDate) {
      const joiningDateFilter: any = {};
      if (fromJoiningDate) joiningDateFilter.gte = new Date(fromJoiningDate);
      if (toJoiningDate)   joiningDateFilter.lte = new Date(toJoiningDate);
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
          joiningDate: true,
          products: true,
          isActive: true,
          createdAt: true,
          _count: { select: { leads: true } },
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
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch customers");
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
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

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
        joiningDate: joiningDate ? new Date(joiningDate) : undefined,
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
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const { id } = req.params;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return sendErrorResponse(res, 404, "Customer not found");

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...req.body,
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
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

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
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const { id } = req.params;
    const { name, price } = req.body;

    if (!name || !price)
      return sendErrorResponse(res, 400, "Product name & price required");

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
      addedAt: new Date(),
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
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

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
