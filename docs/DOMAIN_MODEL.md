# Domain Model

## Entity Relationship Overview
The system domain consists of multiple inter-connected tables mapped via Prisma ORM:

```mermaid
erDiagram
    Account ||--o| User : "authenticates"
    Account ||--o| RegistrationRequest : "requests onboarding"
    Account ||--o| SalaryStructure : "defines pay"
    Account ||--o{ MonthlySalary : "earns"
    Account ||--o{ AttendanceLog : "logs"
    Account ||--o{ TaskAssignment : "assigned to"
    Account ||--o{ Lead : "manages/creates"
    Account ||--o{ UserProductExpertise : "knows"
    
    Project ||--o| ProjectPipeline : "contains"
    Project ||--o{ Task : "has"
    ProjectPipeline ||--o{ PipelineStep : "defines"
    Task ||--o{ TaskAssignment : "assigned to"
    Lead ||--o{ LeadAssignment : "assigned to"
```

## Description of Entities
- **Account**: Main employee record storing designations and personal details.
- **User**: Authentication details including username and hashed password.
- **Task**: Action item. If `isLearning` is true, it marks a developer training task.
- **Lead**: Store details about sales prospects, including `demoCount` and status.
- **UserProductExpertise**: Intersection table mapping an account to a product and expertise levels (`BEGINNER`, `INTERMEDIATE`, `EXPERT`).
