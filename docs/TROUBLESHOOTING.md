# Troubleshooting Guide

## Common Issues & Fixes

### 1. Database Connection Timeout
- **Cause**: Incorrect database URL or Postgres server is down.
- **Fix**: Check `DATABASE_URL` in `.env`. Ensure Postgres port `5432` is listening.

### 2. Module Resolution Errors
- **Cause**: Out-of-sync type files or node module paths mismatch.
- **Fix**: Re-install dependencies and verify path aliases setup in `tsconfig.json` and package.json:
  ```bash
  rm -rf node_modules package-lock.json && npm install
  ```

### 3. Socket Connection Failures
- **Cause**: CORS configurations mismatch between client and server hosts.
- **Fix**: Check that `CORS_ORIGIN` configurations matches frontend URL.
