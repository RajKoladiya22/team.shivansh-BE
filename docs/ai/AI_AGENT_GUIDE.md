# AI Agent Repository Guide

## Rules of Engagement
- **No Direct Schema Mutates**: Never edit the Prisma database schema without creating a matching migration file.
- **No `any` Types**: Retain strict TypeScript compiler compliance.
- **Preserve Comments**: Do not clear existing codebase comments or docstrings.
- **Error Handling**: Wrap controller contexts inside `try/catch` or helper async-wrappers.
