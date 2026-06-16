# Deployment Guide

## Production Deployment Steps

### 1. Build Compilation
```bash
npm run build
```
This compiles the TypeScript files to directory `/dist` and copies EJS templates (`views/`).

### 2. Database Migration Deployment
```bash
npm run migration:deploy
```
This runs outstanding database migrations against the production database URL.

### 3. Process Manager Setup (PM2)
Manage the server process using PM2 to ensure auto-restart on failures:
```bash
# Start script
npm run start:prod
```
The script runs `cross-env NODE_ENV=production pm2 start dist/src/server.js --name Team-API`.
