# Sockets

The Lead Management module relies on Socket.IO for real-time bidirectional communication.

## Events Emitted by Server
- `LEAD_ASSIGNED`: Sent to an employee's specific room when a lead is assigned to them.
- `LEAD_UPDATED`: Broadcasted when key details (like status) of a lead change.
- `NEW_LEAD_ACTIVITY`: Sent when a new remark or time entry is logged.

## Client Subscriptions
Clients connect to their personal namespace/room based on their `accountId`. Global admins subscribe to a general `admin` room to receive aggregated updates across the system.
