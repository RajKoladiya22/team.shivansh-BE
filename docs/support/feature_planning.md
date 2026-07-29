# Support Management Feature Planning (Backend)

## 1. Objectives & Scope
**Objective**: Build a robust, independent Support Management module to track customer support activities, troubleshooting, training, and maintenance, mirroring the architectural patterns of the Lead Management module.
**Scope**: 
- Dedicated database tables (Support, Assignment, Activity, Time Logs).
- REST APIs for CRUD operations.
- Real-time socket events for assignments and status updates.
- Role-based permissions matching the existing ADMIN/EMPLOYEE structure.

## 2. Database Design & Entity Relationships
- **Support**: Links to `Customer`. Tracks product, subject, description, type, status, createdBy, and timestamps.
- **SupportAssignment**: Links `Support` to `Account` (Employee) and optionally an Expert.
- **SupportActivityLog**: Immutable ledger tracking every change (status shifts, reassignments, remarks).
- **SupportTimeLog**: Tracks explicit time spent by an employee on a ticket.

## 3. API Architecture
- `GET /api/v1/supports`: Paginated list with extensive filters (status, employee, product).
- `GET /api/v1/supports/:id`: Detailed fetch including timelines and nested relations.
- `POST /api/v1/supports`: Creation endpoint.
- `PATCH /api/v1/supports/:id`: Update status/details.
- `POST /api/v1/supports/:id/assign`: Reassign tickets.
- `POST /api/v1/supports/:id/time`: Log time spent.

## 4. Permissions & Security
- **ADMIN**: Global read/write, reassignment, reporting access.
- **EMPLOYEE**: Read/write only for assigned supports or self-created supports. Cannot delete.

## 5. Socket Events & Real-time Synchronization
- `SUPPORT_CREATED`: Broadcast to assigned employee.
- `SUPPORT_UPDATED`: Broadcast changes in status or priority.
- `NEW_SUPPORT_REMARK`: Instantly push new comments to active viewers.

## 6. Future Scalability & Reporting Architecture
- The schema separates Time Logs and Activity Logs to easily query average resolution times, employee performance (tickets closed vs time spent), and product-wise support burdens.

## 7. Performance Considerations
- Database indexes on `status`, `customerId`, and `assignedTo` for rapid list filtering.
- Pagination implemented at the database level using Prisma `skip` and `take`.

## 8. Testing Strategy
- **Unit Tests**: Validate status transitions and permission checks in `support.service.ts`.
- **Integration Tests**: End-to-end API testing for the assignment flow.

## 9. Development Milestones
1. Schema & Migration.
2. Services & CRUD Controllers.
3. Permissions & Sockets integration.
4. Testing & Review.
