# Coding Standards

## TypeScript Guidelines
- **Strict Typing**: Avoid using `any`. Define interfaces or types for all return objects.
- **Modular Imports**: Prefer path aliases (`@core`, `@config`, `@routes`, `@domains`) over relative paths.
- **Zod Validation**: Validate all incoming parameters from requests (req.body, req.query, req.params).

## API Controller Guidelines
- **Async Error Handling**: Wrap controller endpoints with an async handler wrapper to catch and pipe exceptions to error middlewares.
- **Response Structure**: Always return standardized JSON structures:
  ```json
  {
    "success": true,
    "data": { ... }
  }
  ```
- **HTTP Codes**: Use semantic codes (200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 500 Internal Error).
