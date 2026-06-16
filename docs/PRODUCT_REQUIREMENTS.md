# Product Requirements Document (PRD)

## Core Modules & Requirements

### 1. Human Resources (HR)
- **Employee Lifecycle**: Capture personal details, bank records, and document uploads.
- **Role-Based Permissions**: Dynamic control based on `ADMIN`, `EMPLOYEE`, `SALES`, and `INTERN` roles.
- **Registration Requests**: System gatekeeper where admins review new signups.

### 2. Time & Attendance
- **Daily Check-Ins**: Users log attendance statuses with geolocation/IP options.
- **Leave Management**: Leave requests submit reason and dates, prompting admin approval.
- **Activity Tracker**: Tracks busy durations for meeting blocks, manual logs, and tasks.

### 3. Payroll & Payslips
- **Salary Config**: Store base salary, HRA percentage, and custom allowances.
- **Payroll Generation**: Bulk-calculate monthly net payouts using attendance metrics and custom deduction formulas.
- **Payslips**: Auto-generate PDF salary statements and email notice alerts.

### 4. Lead Management
- **Lead Intake**: Capture contact info, source, demo counts, and requirements.
- **Lead Assignment**: Distribute leads to sales agents, recording assignments and helpers.
- **Demos**: Log lead demo schedules and conversion success counters.

### 5. Project & Task Board
- **Pipeline Boards**: Drag-and-drop workflow status boards for tasks.
- **Learning Tasks**: Track skill development separately (`isLearning: true` tasks).
- **Time Sheets**: Track actual task duration using timers.

### 6. Cloud Service Monitor
- **Infrastructure Audits**: Record domain renewals, server statuses, and cloud account billing logs.
