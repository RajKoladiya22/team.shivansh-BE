# AI Architecture Guide

## System Layering
- **Routers**: Route requests, apply validations (`zod` schema check), authorize roles (`rbacGuard`).
- **Controllers**: Main execution context. Pre-fetch batch database values to avoid loop-queries.
- **Database Layer**: Prisma client operations, transactions for multi-record operations.
- **Events**: Socket emits.
