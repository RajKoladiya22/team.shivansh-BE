# AI Coding Guidelines

## Coding Patterns
- **Database Transactions**: Group related updates using `prisma.$transaction([])` for safety.
- **Standardized DTOs**: Create zod objects to parse and type-cast incoming parameters.
- **Path Aliases**: Maintain modular path imports.
