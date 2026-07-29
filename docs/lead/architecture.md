# Architecture

## Layered Design

The module follows a layered architecture to ensure separation of concerns:

1. **Routes (`src/routes/lead.route.ts`)**: Defines the API endpoints and binds them to controller methods. Applies authentication and RBAC middleware.
2. **Controllers (`src/controller/lead/`)**: Handles incoming HTTP requests, extracts parameters/body, calls the appropriate service, and formats the JSON response.
3. **Services (`src/services/lead/`)**: Contains the core business logic. Responsible for querying the database via Prisma, managing assignments, logging activities, and triggering socket events.
4. **Validation (`src/validation/lead.validation.ts`)**: Ensures data integrity for incoming requests before they hit the controller logic.

## Data Flow
Client Request -> Router -> Auth Middleware -> Validation -> Controller -> Service -> Prisma ORM -> Database.
