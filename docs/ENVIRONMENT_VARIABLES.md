# Environment Variables

## Configuration Details

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | The port Express will listen on | `9090` |
| `NODE_ENV` | Mode of operation | `development` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `JWT_ACCESS_TOKEN_SECRET` | Secret key for access token signing | `your_secret_access_key` |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifespan | `1d` |
| `JWT_REFRESH_TOKEN_SECRET`| Secret key for refresh token signing | `your_secret_refresh_key` |
| `JWT_REFRESH_EXPIRES_IN`| Refresh token lifespan | `7d` |
| `SMTP_HOST` | Host address of SMTP server | `smtp.gmail.com` |
| `SMTP_USER` | Email username for email alerts | `example@gmail.com` |
| `SMTP_PASS` | Password/App password for SMTP | `smtp_app_password` |
