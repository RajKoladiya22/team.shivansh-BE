# API Authentication

## Summary
Secure authentication is based on JWT (JSON Web Tokens).

## Access and Refresh Tokens
- **Access Token**: Sent as a HTTPOnly cookie or authorization header. Valid for 1 day.
- **Refresh Token**: Valid for 7 days, used to regenerate access tokens without credentials.
