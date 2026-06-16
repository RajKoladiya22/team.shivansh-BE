# Development Setup

## Installation Guidelines

### 1. Clone & Install
```bash
git clone <repo-url> team.shivansh-BE
cd team.shivansh-BE
npm install
```

### 2. Configure Environment variables
Copy `.env.development` to `.env.local` or `.env.development` and modify variables like database credentials.

### 3. Database Sync & Seeding
```bash
# Sync database schema
npx prisma db push

# Generate client
npm run prisma:generate

# Seed database
npm run seed
```

### 4. Running the Dev Server
```bash
npm run dev
```
