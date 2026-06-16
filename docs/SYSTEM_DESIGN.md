# System Design

## Codebase Organization
The backend project is structured modularly:
- `/src/app.ts`: Setup of Express settings, CORS configs, parsing middleware, and route registrations.
- `/src/server.ts`: Initializer of HTTP server and Socket.IO engine.
- `/src/config/`: App environment configurations, validations using Zod.
- `/src/controller/`: Domain controllers grouped by module.
- `/src/routes/`: Route declarations.
- `/src/services/`: Reusable database interactions or third-party service adapters.
- `/src/sockets/`: Namespace definitions and events.

## Key Subsystems
- **RBAC Guard**: Express middleware auditing requested routes against `UserRole` and `RolePermission` models.
- **Database Transaction Engine**: Batch queries used in payroll and task assignments to ensure ACID compliance.
- **File Upload Handler**: `Multer` combined with `Cloudinary` service uploads to host assets.
