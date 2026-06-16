# AI Decision Log

## Historical Architectural Decisions
- **Decision 1**: Adopt Prisma ORM.
  - **Reason**: Standardizes type-safety and query mappings out of the box.
- **Decision 2**: Socket.IO for Communication.
  - **Reason**: Simplifies real-time event loops compared to standard polling.
- **Decision 3**: Pre-grouping UserProductExpertise queries.
  - **Reason**: Resolved N+1 performance bottleneck when fetching employee analytic cards.
