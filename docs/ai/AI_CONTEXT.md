# AI Context Document

## Business Purpose
Team Shivansh manages internal Shivansh Infosys ERP functions: HR profiles, payroll, attendance, lead conversions, project task pipelines, and cloud service tracking.

## Technical Framework
- **Runtime**: Node.js, TypeScript.
- **Framework**: Express.js.
- **ORM**: Prisma Client.
- **Database**: PostgreSQL.

## Folder Directory
- `src/controller/`: Business operations handlers.
- `src/routes/`: Router directories.
- `src/sockets/`: Real-time socket logic.
- `prisma/`: Prisma Schema and DB configurations.
- `views/`: EJS templates for payslip generation.

## Dependencies
- `@prisma/client`, `socket.io`, `zod`, `jose`, `bcryptjs`, `xlsx`, `puppeteer`, `nodemailer`.
