# AI Modification Workflows

## Actionable Steps for Changes
1. **Prisma Schema Changes**:
   - Update `prisma/schema.prisma`.
   - Run `npx prisma migrate dev --name <description>`.
   - Update controller types.
2. **API Endpoint Additions**:
   - Define zod payload schemas.
   - Implement route in `src/routes/`.
   - Register route in `src/routes/index.ts`.
   - Write controller implementation.
