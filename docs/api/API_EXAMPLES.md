# API Call Examples

## Create Task
```bash
curl -X POST http://localhost:9090/api/v1/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"title": "Implement Docs", "projectId": "uuid", "priority": "HIGH"}'
```
