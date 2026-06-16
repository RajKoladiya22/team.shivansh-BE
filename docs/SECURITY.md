# Security Architecture

## Protocols & Safeguards
- **Password Protection**: Hashed using bcrypt algorithm before storing.
- **Route Authorization (RBAC)**: All endpoints query user roles and permissions in real time to authorize requests.
- **Express Middleware Protection**:
  - `helmet`: Enhances HTTP response headers for protection.
  - `cors`: White-lists authorized frontend domains.
  - `express-rate-limit`: Prevents DDoS and brute force login attempts.
- **Secrets Encryption**: Critical credentials (like database secrets) are stored in server-level environment variables, never committed to source control.
