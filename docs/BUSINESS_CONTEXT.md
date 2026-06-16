# Business Context

## Business Domain
Team Shivansh serves as an internal ERP platform for **Shivansh Infosys**, a software consulting and development agency. The tool addresses the operational challenges of managing a fast-paced agency.

## Core Business Entities
- **Account**: Representation of a team member containing HR metadata.
- **Lead**: Potential sales opportunities requiring demos.
- **Task**: Client or learning tasks assigned to developers.
- **MonthlySalary**: Payroll ledger record generated per month.
- **DsuEntry**: Daily Standup reports mapping daily goals and progress.

## Key Business Rules
1. **Attendance-Salary Coupling**: Salary payouts calculations are affected by active leave request approvals and absent logs.
2. **Lead-to-Demo Conversion**: Demos are a critical indicator of customer engagement. Leads must track `demoCount` and update dates when demo completions occur.
3. **Learning Journeys**: Interns are assigned `isLearning` tasks. Metrics track these separately to evaluate training progression.
4. **User Product Expertise**: Developers must maintain mapped product capabilities (`UserProductExpertise`) graded from `BEGINNER` to `EXPERT` for optimal resource planning.
