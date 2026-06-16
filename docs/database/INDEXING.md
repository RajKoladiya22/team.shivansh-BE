# Database Indexing

## Configured Indexes
Prisma schema defines indices on high-query columns:
- `@@index([isActive])` on `Account`
- `@@index([status])` on `Lead`
- `@@index([projectId])` on `Task`
