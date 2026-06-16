# AI Debugging Guide

## Debug Steps
- **Prisma Client Issues**: Run `npm run prisma:generate` to refresh typescript types.
- **Route 404s**: Confirm registration in `src/routes/index.ts` and verify route prefixes.
- **Token Decoding Errors**: Verify matching `JWT_ACCESS_TOKEN_SECRET` in environment.
