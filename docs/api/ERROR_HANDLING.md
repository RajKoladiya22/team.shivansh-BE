# API Error Handling

## Pattern
Errors are captured via middleware and returned in standard formats:
```json
{
  "success": false,
  "error": "Error description message"
}
```
