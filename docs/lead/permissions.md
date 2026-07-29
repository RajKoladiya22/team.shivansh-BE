# Permissions

Access control is enforced via middleware using the `Role` and `Permission` models.

## ADMIN Role
- Has full access to all Lead Management resources.
- Can view, create, edit, and delete any lead.
- Can assign or reassign leads to any employee.
- Can view global reports and analytics.
- Can access the full activity log for all leads.

## EMPLOYEE Role
- Can view leads assigned to them.
- Can view leads they created.
- Can create new leads (and optionally auto-assign to themselves).
- Can update the status, add remarks, and log time for their assigned leads.
- **Restrictions**:
  - Cannot view leads assigned to other employees.
  - Cannot delete leads.
  - Cannot view global reporting metrics.
