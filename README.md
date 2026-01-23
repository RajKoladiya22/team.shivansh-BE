# Team Shivansh - Backend API

A comprehensive backend for the **Team Shivansh** ERP and Team Management System. This application handles Human Resource management, Payroll processing, Lead tracking, and Project management with real-time capabilities.

## 🚀 Features

- **Authentication & RBAC**: Secure JWT-based authentication with Role-Based Access Control (Admin, Employee, Leads).
- **Core HR**:
  - Employee Profile Management (Personal, Banking, Documents).
  - Attendance Tracking (Daily logs, status, busy flags).
  - Leave Management (Requests, Approvals).
- **Payroll System**:
  - Salary Structure management.
  - Monthly Salary generation with automated calculations.
  - PDF Generation for payslips.
- **Project Management**:
  - Pipelines and Drag-and-Drop Task boards.
  - Project timelines and team assignments.
- **Communication**:
  - **Socket.io** integration for real-time updates.
  - Email notifications via **Nodemailer**.
  - WhatsApp integration via Meta API.
- **Reporting & Utilities**:
  - Cloudinary integration for file storage.
  - Excel/CSV export/import.

## 🛠 Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Database**: [PostgreSQL](https://www.postgresql.org/) using [Prisma ORM](https://www.prisma.io/)
- **Validation**: [Zod](https://zod.dev/) & Express-Validator
- **Real-time**: [Socket.io](https://socket.io/)
- **Storage**: [Cloudinary](https://cloudinary.com/)

## 📂 Project Structure

```
├── src
│   ├── config/       # Environment & DB configuration
│   ├── controller/   # Request handlers (Business Logic)
│   ├── core/         # Shared utilities, middleware, logger
│   ├── routes/       # API Route definitions
│   ├── sockets/      # Socket.io event handlers
│   ├── app.ts        # Express App setup
│   └── server.ts     # Entry point
├── prisma
│   ├── schema.prisma # Database schema
│   └── migrations/   # SQL migrations
├── views/            # EJS Templates
└── dist/             # Compiled JavaScript code
```

## ⚙️ Pre-requisites

- Node.js (v18+ recommended)
- PostgreSQL Database
- npm or yarn

## ⚡️ Getting Started

### 1. Clone the repository
```bash
git clone <repository-url>
cd team.shivansh-BE
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup
Create a `.env` file in the root directory (copy from `.env.development` or `.env.example`).
```env
# Server
NODE_ENV=development
PORT=9090
BASE_URL=http://localhost:9090

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/team-shivansh"

# Authentication
JWT_ACCESS_TOKEN_SECRET=your_secret_access_key
JWT_ACCESS_EXPIRES_IN=1d
JWT_REFRESH_TOKEN_SECRET=your_secret_refresh_key
JWT_REFRESH_EXPIRES_IN=7d
SALT_ROUNDS=12
STATIC_TOKEN="your_static_token_for_internal_apis"

# Services
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

### 4. Database Setup
Apply migrations to sync your database with the Prisma schema.
```bash
# Run migrations
npx prisma migrate dev

# (Optional) Seed the database if a seed script exists
npm run seed
```

### 5. Run the Application

**Development Mode** (Hot Reload):
```bash
npm run dev
```

**Production Build**:
```bash
npm run build
npm run start:prod
```

## 📜 Scripts

- `npm run dev`: Start development server with `ts-node-dev`.
- `npm run build`: Compile TypeScript to `dist`.
- `npm run lint`: Lint code with ESLint.
- `npm run format`: Format code with Prettier.
- `npm run prisma:generate`: Generate Prisma Client.
- `npm run migration:generate`: Create a new migration.

## 🤝 Contributing

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---
**Team Shivansh** Internal Tool