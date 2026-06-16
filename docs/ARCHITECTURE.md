# System Architecture

## Core Components
The system follows a classic client-server monolithic backend pattern:

1. **Routing Layer (`src/routes/`)**: Express routers parsing HTTP requests and delegating to handlers.
2. **Controller Layer (`src/controller/`)**: Business orchestration logic, input validations, database transactions.
3. **Data Access Layer (`prisma/`)**: Prisma Client acting as the ORM mapper to PostgreSQL.
4. **Real-time Event Server (`src/sockets/`)**: Socket.io middleware managing bidirectional client events.
5. **Cron Scheduler (`src/cron/`)**: Automated task runner for monthly payroll and database cleanup.

## Communication Architecture
- **Stateless REST APIs**: Client authentication uses signed JWTs stored in secure cookies or headers.
- **Stateful Socket.io Connections**: Clients establish a websocket connection for real-time chat, alerts, and system-wide notifications.
- **Event Flow**:
  ```mermaid
  sequenceDiagram
    participant FE as React Client
    participant BE as Express Router
    participant DB as Postgres
    participant Sock as Socket Engine
    
    FE->>BE: POST /api/v1/tasks (Create Task)
    BE->>DB: Prisma Create Task
    DB-->>BE: Returns Task
    BE->>Sock: Emit "task_created" to Project Room
    Sock-->>FE: Real-time update event
    BE-->>FE: HTTP 201 Created
  ```
