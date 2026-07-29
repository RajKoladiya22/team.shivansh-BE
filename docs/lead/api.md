# API Endpoints

The API is structured around RESTful principles.

## `GET /api/v1/leads`
Retrieve a paginated, filterable list of leads.
- **Query Params**: `page`, `limit`, `status`, `assignedTo`, `search` (name, mobile)
- **Returns**: `{ data: Lead[], meta: { total, page, limit } }`

## `GET /api/v1/leads/:id`
Retrieve detailed information about a specific lead, including assignments, follow-ups, and activity logs.

## `POST /api/v1/leads`
Create a new lead.
- **Body**: `customerName`, `mobileNumber`, `product`, `source`, `type`

## `PATCH /api/v1/leads/:id`
Update lead details (status, remarks, prioritization).

## `POST /api/v1/leads/:id/assign`
Assign a lead to an employee or team.
- **Body**: `accountId` or `teamId`

## `POST /api/v1/leads/:id/follow-up`
Schedule a follow-up.
- **Body**: `type`, `scheduledAt`, `remark`

## `POST /api/v1/leads/:id/time`
Log time spent working on a lead.
- **Body**: `seconds`
