# Database Schema

## Core Models

### `Lead`
Represents the main lead entity.
- **id**: Primary Key (UUID)
- **source**, **type**: Enums categorizing the lead
- **status**: Current status (`PENDING`, `IN_PROGRESS`, etc.)
- **customerName**, **mobileNumber**: Contact details
- **product**: JSON / Relationship mapping to interested products
- **isWorking**, **isImportant**: Flags for prioritization
- **createdBy**: Foreign Key to `Account` (who created it)
- **customerId**: Foreign Key to `Customer` (if converted)
- **closedAt**: Timestamp when lead was closed/converted

### `LeadAssignment`
Handles assignments to employees or teams.
- **leadId**: Foreign Key to `Lead`
- **accountId**: Foreign Key to `Account`
- **teamId**: Foreign Key to `Team`
- **assignedBy**: Foreign Key to `Account` (admin/manager)
- **WorkSeconds**: Time logged against the lead
- **assignedAt**, **unassignedAt**: Assignment lifecycle tracking

### `LeadFollowUp`
Tracks scheduled follow-up tasks.
- **leadId**: Foreign Key to `Lead`
- **type**: Enum (`CALL`, `MEETING`, etc.)
- **status**: Enum (`PENDING`, `DONE`, `CANCELLED`)
- **scheduledAt**: Target datetime
- **doneAt**: Completion datetime
- **doneBy**: Foreign Key to `Account`

### `LeadActivityLog`
Immutable audit trail of actions performed on the lead.
- **leadId**: Foreign Key to `Lead`
- **action**: Enum mapping the exact action
- **meta**: JSON payload containing old/new values
- **performedBy**: Foreign Key to `Account`
- **createdAt**: Timestamp
