-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "SalaryMonthStatus" AS ENUM ('PENDING', 'GENERATED', 'CREDITED', 'HOLD');

-- CreateEnum
CREATE TYPE "SalaryNoticeStatus" AS ENUM ('SENT', 'VIEWED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "JDVisibility" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'REMOTE', 'CONTRACT', 'FREELANCE', 'PART_TIME', 'INTERNSHIP', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('PRIVATE', 'TEAM', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PipelineSource" AS ENUM ('BLANK', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('ACCOUNT', 'TEAM');

-- CreateEnum
CREATE TYPE "ActivityEntity" AS ENUM ('PROJECT', 'PIPELINE', 'PIPELINE_STEP', 'TASK', 'COMMENT', 'ATTACHMENT', 'LABEL');

-- CreateEnum
CREATE TYPE "TaskRecurrenceType" AS ENUM ('ONE_TIME', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TemplateAssignmentStrategy" AS ENUM ('PROJECT_ROLE', 'CREATOR', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ProjectRoleType" AS ENUM ('OWNER', 'MANAGER', 'MEMBER', 'VIEWER', 'REVIEWER');

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'ASSIGNED', 'UNASSIGNED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'DUE_DATE_CHANGED', 'MOVED', 'COMMENTED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED', 'COMPLETED', 'REOPENED', 'BLOCKED', 'UNBLOCKED', 'ARCHIVED', 'RESTORED');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CommentVisibility" AS ENUM ('ALL', 'MANAGERS');

-- CreateEnum
CREATE TYPE "AttachmentSource" AS ENUM ('UPLOAD', 'URL', 'GDRIVE', 'NOTION', 'FIGMA', 'GITHUB_PR');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MANUAL', 'WHATSAPP', 'INQUIRY_FORM', 'WEBSITE', 'YOUTUBE', 'ADVERTISEMENT', 'PBN');

-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('LEAD', 'SUPPORT');

-- CreateEnum
CREATE TYPE "Lead_Status" AS ENUM ('PENDING', 'IN_PROGRESS', 'FOLLOW_UPS', 'DEMO_DONE', 'INTERESTED', 'CONVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LeadActivityAction" AS ENUM ('CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'ASSIGN_CHANGED', 'UPDATED', 'CLOSED', 'HELPER_ADDED', 'HELPER_REMOVED', 'WORK_STARTED', 'WORK_ENDED', 'FOLLOW_UP_SCHEDULED', 'FOLLOW_UP_DONE', 'FOLLOW_UP_MISSED', 'FOLLOW_UP_RESCHEDULED', 'REMINDER_SENT');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'DONE', 'MISSED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('CALL', 'DEMO', 'MEETING', 'VISIT', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadHelperRole" AS ENUM ('EXPORT', 'SUPPORT', 'CONSULT');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('SYSTEM', 'REMINDER', 'ALERT', 'WARNING', 'MESSAGE', 'TASK', 'LEAD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NotificationLevel" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'IN_APP', 'PUSH');

-- CreateEnum
CREATE TYPE "TemplateVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END');

-- CreateEnum
CREATE TYPE "BreakType" AS ENUM ('LUNCH', 'TEA', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CheckSource" AS ENUM ('MANUAL', 'AUTO', 'ADMIN');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('FULL_DAY', 'HALF_DAY', 'MULTI_DAY');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DsuFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'MULTISELECT', 'DATE', 'CHECKBOX', 'RICH_TEXT', 'ATTACHMENT');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'IN_PERSON', 'PORTAL');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('GST', 'IGST', 'NONE');

-- CreateEnum
CREATE TYPE "QuotationActivityAction" AS ENUM ('CREATED', 'UPDATED', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED', 'CANCELLED', 'REVISED', 'REMINDER_SENT', 'NOTE_ADDED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "registerNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "address" JSONB,
    "avatar" TEXT,
    "documents" JSONB,
    "bio" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "jobType" "JobType",
    "isJdAccept" BOOLEAN NOT NULL DEFAULT false,
    "designation" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isBusy" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "activeLeadId" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationRequest" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "accountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "RegistrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    "hraPercent" DECIMAL(5,2),
    "allowance" DECIMAL(12,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRevision" (
    "id" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "previousSalary" DECIMAL(12,2) NOT NULL,
    "revisedSalary" DECIMAL(12,2) NOT NULL,
    "applicableFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "revisedBy" TEXT NOT NULL,
    "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlySalary" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "basic" DECIMAL(12,2) NOT NULL,
    "hra" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "status" "SalaryMonthStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "generatedAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),

    CONSTRAINT "MonthlySalary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStatement" (
    "id" TEXT NOT NULL,
    "monthlySalaryId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfUrl" TEXT,

    CONSTRAINT "SalaryStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryNotice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "revisionId" TEXT,
    "monthlySalaryId" TEXT,
    "message" TEXT,
    "status" "SalaryNoticeStatus" NOT NULL DEFAULT 'SENT',
    "sentBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "SalaryNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDetail" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusyActivityLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fromBusy" BOOLEAN NOT NULL,
    "toBusy" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusyActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "PasswordOTP" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "otpCode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordOTP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "designation" TEXT,
    "summary" TEXT,
    "responsibilitiesMust" JSONB NOT NULL,
    "responsibilitiesMay" JSONB NOT NULL,
    "responsibilitiesMustNot" JSONB NOT NULL,
    "companyRules" JSONB NOT NULL,
    "expectations" JSONB,
    "notes" JSONB,
    "visibility" "JDVisibility" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskLabel" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "addedBy" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "ProjectVisibility" NOT NULL DEFAULT 'TEAM',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "color" TEXT,
    "icon" TEXT,
    "coverUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "ProjectRoleType" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAttachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "AttachmentSource" NOT NULL DEFAULT 'UPLOAD',
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "meta" JSONB,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCustomField" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCustomFieldValue" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineTemplateStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "description" TEXT,
    "color" TEXT,

    CONSTRAINT "PipelineTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineTemplateTask" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "offsetDays" INTEGER DEFAULT 0,
    "defaultAssignmentStrategy" "TemplateAssignmentStrategy",
    "defaultRoleId" TEXT,

    CONSTRAINT "PipelineTemplateTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPipeline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "PipelineSource" NOT NULL DEFAULT 'BLANK',
    "sourceTemplateId" TEXT,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStep" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "wipLimit" INTEGER NOT NULL DEFAULT 0,
    "templateStepId" TEXT,

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "stepId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "loggedMinutes" INTEGER NOT NULL DEFAULT 0,
    "isSelfTask" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceType" "TaskRecurrenceType" NOT NULL DEFAULT 'ONE_TIME',
    "recurrenceRule" JSONB,
    "recurrenceParentId" TEXT,
    "parentTaskId" TEXT,
    "templateTaskId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "AssignmentType" NOT NULL,
    "accountId" TEXT,
    "teamId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "dependentTaskId" TEXT NOT NULL,
    "blockingTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "order" INTEGER NOT NULL DEFAULT 0,
    "assignedTo" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" "CommentVisibility" NOT NULL DEFAULT 'ALL',
    "parentCommentId" TEXT,
    "reactions" JSONB,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentMention" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "AttachmentSource" NOT NULL DEFAULT 'UPLOAD',
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "meta" JSONB,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskWatcher" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "watchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskWatcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTimeEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "description" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "entityType" "ActivityEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "meta" JSONB,
    "fromState" JSONB,
    "toState" JSONB,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT,
    "taskId" TEXT,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "type" "LeadType" NOT NULL,
    "status" "Lead_Status" NOT NULL DEFAULT 'PENDING',
    "statusMark" JSONB,
    "demoScheduledAt" TIMESTAMP(3),
    "demoDoneAt" TIMESTAMP(3),
    "demoCount" INTEGER NOT NULL DEFAULT 0,
    "demoMeta" JSONB,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastFollowUpDoneAt" TIMESTAMP(3),
    "customerName" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "customerCompanyName" TEXT,
    "product" JSONB,
    "productTitle" TEXT,
    "cost" DECIMAL(12,2),
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isWorking" BOOLEAN NOT NULL DEFAULT false,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "totalWorkSeconds" INTEGER NOT NULL DEFAULT 0,
    "customerId" TEXT,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "AssignmentType" NOT NULL,
    "accountId" TEXT,
    "teamId" TEXT,
    "remark" JSONB,
    "WorkSeconds" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadHelper" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "LeadHelperRole" NOT NULL DEFAULT 'EXPORT',
    "addedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "LeadHelper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFollowUp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "FollowUpType" NOT NULL DEFAULT 'CALL',
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "remark" TEXT,
    "rescheduledToId" TEXT,
    "createdBy" TEXT,
    "doneBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivityLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "action" "LeadActivityAction" NOT NULL,
    "meta" JSONB,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerCompanyName" TEXT,
    "contactPerson" TEXT,
    "mobile" TEXT NOT NULL,
    "normalizedMobile" TEXT NOT NULL,
    "email" TEXT,
    "emails" JSONB,
    "phones" JSONB,
    "city" TEXT,
    "state" TEXT,
    "joiningDate" TIMESTAMP(3),
    "customerCategory" TEXT,
    "businessCategory" TEXT,
    "tallySerial" TEXT,
    "tallyVersion" TEXT,
    "products" JSONB,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "category" "NotificationCategory" NOT NULL,
    "level" "NotificationLevel" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "actionUrl" TEXT,
    "dedupeKey" TEXT,
    "deliveryChannels" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TIMESTAMP(3),
    "remindAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "platform" TEXT,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "TemplateVisibility" NOT NULL DEFAULT 'PRIVATE',
    "accountId" TEXT,
    "channels" JSONB NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "meta" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplatePreference" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplatePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "type" "CheckType" NOT NULL,
    "source" "CheckSource" NOT NULL DEFAULT 'MANUAL',
    "breakType" "BreakType",
    "sessionId" TEXT,
    "ipAddress" TEXT,
    "deviceMeta" JSONB,
    "note" TEXT,
    "editedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendanceLogId" TEXT,

    CONSTRAINT "CheckLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "day" TEXT NOT NULL,
    "firstCheckIn" TIMESTAMP(3),
    "lastCheckOut" TIMESTAMP(3),
    "totalWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "hasOpenSession" BOOLEAN NOT NULL DEFAULT false,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "isSunday" BOOLEAN NOT NULL DEFAULT false,
    "overrideNote" TEXT,
    "overrideBy" TEXT,
    "totalBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "hasOpenBreak" BOOLEAN NOT NULL DEFAULT false,
    "isWFH" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsuTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "teamId" TEXT,
    "createdBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DsuTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsuTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DsuTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsuEntry" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "accountId" TEXT NOT NULL,
    "teamId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "content" JSONB NOT NULL,
    "summary" TEXT,
    "attachments" JSONB,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "meta" JSONB,
    "textSearch" TEXT,

    CONSTRAINT "DsuEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" "QuotationChannel" NOT NULL DEFAULT 'EMAIL',
    "customerId" TEXT NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "preparedBy" TEXT,
    "lineItems" JSONB NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "totalDiscount" DECIMAL(14,2) NOT NULL,
    "totalTax" DECIMAL(14,2) NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "extraDiscountType" "DiscountType",
    "extraDiscountValue" DECIMAL(10,2),
    "extraDiscountNote" TEXT,
    "taxType" "TaxType" NOT NULL DEFAULT 'GST',
    "gstin" TEXT,
    "customerGstin" TEXT,
    "placeOfSupply" TEXT,
    "quotationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "leadId" TEXT,
    "subject" TEXT,
    "introNote" TEXT,
    "termsNote" TEXT,
    "footerNote" TEXT,
    "paymentTerms" TEXT,
    "paymentDueDays" INTEGER,
    "deliveryScope" TEXT,
    "deliveryDays" INTEGER,
    "sendHistory" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "internalNote" TEXT,
    "tags" TEXT[],
    "acceptedBy" TEXT,
    "acceptanceNote" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationActivity" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "action" "QuotationActivityAction" NOT NULL,
    "performedBy" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "introNote" TEXT,
    "termsNote" TEXT,
    "footerNote" TEXT,
    "paymentTerms" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationSequence" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_registerNumber_key" ON "Account"("registerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Account_contactEmail_key" ON "Account"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Account_contactPhone_key" ON "Account"("contactPhone");

-- CreateIndex
CREATE INDEX "Account_isActive_idx" ON "Account"("isActive");

-- CreateIndex
CREATE INDEX "Account_jobType_idx" ON "Account"("jobType");

-- CreateIndex
CREATE INDEX "Account_contactEmail_idx" ON "Account"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "User_accountId_key" ON "User"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationRequest_contactEmail_key" ON "RegistrationRequest"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationRequest_contactPhone_key" ON "RegistrationRequest"("contactPhone");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationRequest_accountId_key" ON "RegistrationRequest"("accountId");

-- CreateIndex
CREATE INDEX "RegistrationRequest_status_idx" ON "RegistrationRequest"("status");

-- CreateIndex
CREATE INDEX "RegistrationRequest_requestedAt_idx" ON "RegistrationRequest"("requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_accountId_key" ON "SalaryStructure"("accountId");

-- CreateIndex
CREATE INDEX "SalaryStructure_effectiveFrom_idx" ON "SalaryStructure"("effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryRevision_salaryStructureId_idx" ON "SalaryRevision"("salaryStructureId");

-- CreateIndex
CREATE INDEX "SalaryRevision_applicableFrom_idx" ON "SalaryRevision"("applicableFrom");

-- CreateIndex
CREATE INDEX "MonthlySalary_status_idx" ON "MonthlySalary"("status");

-- CreateIndex
CREATE INDEX "MonthlySalary_year_month_idx" ON "MonthlySalary"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlySalary_accountId_month_year_key" ON "MonthlySalary"("accountId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStatement_monthlySalaryId_key" ON "SalaryStatement"("monthlySalaryId");

-- CreateIndex
CREATE INDEX "SalaryNotice_accountId_idx" ON "SalaryNotice"("accountId");

-- CreateIndex
CREATE INDEX "SalaryNotice_sentAt_idx" ON "SalaryNotice"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankDetail_accountId_key" ON "BankDetail"("accountId");

-- CreateIndex
CREATE INDEX "BusyActivityLog_accountId_idx" ON "BusyActivityLog"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "PasswordOTP_userId_used_idx" ON "PasswordOTP"("userId", "used");

-- CreateIndex
CREATE UNIQUE INDEX "JobDescription_accountId_key" ON "JobDescription"("accountId");

-- CreateIndex
CREATE INDEX "JobDescription_designation_idx" ON "JobDescription"("designation");

-- CreateIndex
CREATE INDEX "JobDescription_visibility_idx" ON "JobDescription"("visibility");

-- CreateIndex
CREATE INDEX "Team_isActive_idx" ON "Team"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "TeamMember_accountId_idx" ON "TeamMember"("accountId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_accountId_key" ON "TeamMember"("teamId", "accountId");

-- CreateIndex
CREATE INDEX "Label_isActive_idx" ON "Label"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Label_name_key" ON "Label"("name");

-- CreateIndex
CREATE INDEX "TaskLabel_taskId_idx" ON "TaskLabel"("taskId");

-- CreateIndex
CREATE INDEX "TaskLabel_labelId_idx" ON "TaskLabel"("labelId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskLabel_taskId_labelId_key" ON "TaskLabel"("taskId", "labelId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- CreateIndex
CREATE INDEX "Project_createdBy_idx" ON "Project"("createdBy");

-- CreateIndex
CREATE INDEX "Project_visibility_idx" ON "Project"("visibility");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_idx" ON "ProjectMember"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMember_accountId_idx" ON "ProjectMember"("accountId");

-- CreateIndex
CREATE INDEX "ProjectMember_role_idx" ON "ProjectMember"("role");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_accountId_key" ON "ProjectMember"("projectId", "accountId");

-- CreateIndex
CREATE INDEX "ProjectAttachment_projectId_idx" ON "ProjectAttachment"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAttachment_deletedAt_idx" ON "ProjectAttachment"("deletedAt");

-- CreateIndex
CREATE INDEX "ProjectCustomField_projectId_idx" ON "ProjectCustomField"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCustomField_projectId_name_key" ON "ProjectCustomField"("projectId", "name");

-- CreateIndex
CREATE INDEX "TaskCustomFieldValue_taskId_idx" ON "TaskCustomFieldValue"("taskId");

-- CreateIndex
CREATE INDEX "TaskCustomFieldValue_fieldId_idx" ON "TaskCustomFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCustomFieldValue_taskId_fieldId_key" ON "TaskCustomFieldValue"("taskId", "fieldId");

-- CreateIndex
CREATE INDEX "PipelineTemplate_isActive_idx" ON "PipelineTemplate"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineTemplate_name_key" ON "PipelineTemplate"("name");

-- CreateIndex
CREATE INDEX "PipelineTemplateStep_templateId_idx" ON "PipelineTemplateStep"("templateId");

-- CreateIndex
CREATE INDEX "PipelineTemplateStep_order_idx" ON "PipelineTemplateStep"("order");

-- CreateIndex
CREATE INDEX "PipelineTemplateTask_stepId_idx" ON "PipelineTemplateTask"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPipeline_projectId_key" ON "ProjectPipeline"("projectId");

-- CreateIndex
CREATE INDEX "PipelineStep_pipelineId_idx" ON "PipelineStep"("pipelineId");

-- CreateIndex
CREATE INDEX "PipelineStep_order_idx" ON "PipelineStep"("order");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- CreateIndex
CREATE INDEX "Task_stepId_idx" ON "Task"("stepId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "Task"("priority");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- CreateIndex
CREATE INDEX "Task_recurrenceParentId_idx" ON "Task"("recurrenceParentId");

-- CreateIndex
CREATE INDEX "Task_isSelfTask_idx" ON "Task"("isSelfTask");

-- CreateIndex
CREATE INDEX "Task_sortOrder_idx" ON "Task"("sortOrder");

-- CreateIndex
CREATE INDEX "Task_createdBy_idx" ON "Task"("createdBy");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_projectId_dueDate_idx" ON "Task"("projectId", "dueDate");

-- CreateIndex
CREATE INDEX "Task_stepId_sortOrder_idx" ON "Task"("stepId", "sortOrder");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskId_idx" ON "TaskAssignment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAssignment_accountId_idx" ON "TaskAssignment"("accountId");

-- CreateIndex
CREATE INDEX "TaskAssignment_teamId_idx" ON "TaskAssignment"("teamId");

-- CreateIndex
CREATE INDEX "TaskDependency_dependentTaskId_idx" ON "TaskDependency"("dependentTaskId");

-- CreateIndex
CREATE INDEX "TaskDependency_blockingTaskId_idx" ON "TaskDependency"("blockingTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_dependentTaskId_blockingTaskId_key" ON "TaskDependency"("dependentTaskId", "blockingTaskId");

-- CreateIndex
CREATE INDEX "ChecklistItem_taskId_idx" ON "ChecklistItem"("taskId");

-- CreateIndex
CREATE INDEX "ChecklistItem_order_idx" ON "ChecklistItem"("order");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

-- CreateIndex
CREATE INDEX "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- CreateIndex
CREATE INDEX "TaskComment_parentCommentId_idx" ON "TaskComment"("parentCommentId");

-- CreateIndex
CREATE INDEX "TaskComment_deletedAt_idx" ON "TaskComment"("deletedAt");

-- CreateIndex
CREATE INDEX "CommentMention_accountId_idx" ON "CommentMention"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentMention_commentId_accountId_key" ON "CommentMention"("commentId", "accountId");

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAttachment_deletedAt_idx" ON "TaskAttachment"("deletedAt");

-- CreateIndex
CREATE INDEX "TaskWatcher_taskId_idx" ON "TaskWatcher"("taskId");

-- CreateIndex
CREATE INDEX "TaskWatcher_accountId_idx" ON "TaskWatcher"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskWatcher_taskId_accountId_key" ON "TaskWatcher"("taskId", "accountId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_taskId_idx" ON "TaskTimeEntry"("taskId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_accountId_idx" ON "TaskTimeEntry"("accountId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_startedAt_idx" ON "TaskTimeEntry"("startedAt");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_projectId_idx" ON "ActivityLog"("projectId");

-- CreateIndex
CREATE INDEX "ActivityLog_taskId_idx" ON "ActivityLog"("taskId");

-- CreateIndex
CREATE INDEX "ActivityLog_performedBy_idx" ON "ActivityLog"("performedBy");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_isWorking_idx" ON "Lead"("isWorking");

-- CreateIndex
CREATE INDEX "Lead_createdAt_status_idx" ON "Lead"("createdAt", "status");

-- CreateIndex
CREATE INDEX "Lead_status_demoScheduledAt_idx" ON "Lead"("status", "demoScheduledAt");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_mobileNumber_idx" ON "Lead"("mobileNumber");

-- CreateIndex
CREATE INDEX "Lead_demoScheduledAt_idx" ON "Lead"("demoScheduledAt");

-- CreateIndex
CREATE INDEX "Lead_demoDoneAt_idx" ON "Lead"("demoDoneAt");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_idx" ON "LeadAssignment"("leadId");

-- CreateIndex
CREATE INDEX "LeadAssignment_accountId_idx" ON "LeadAssignment"("accountId");

-- CreateIndex
CREATE INDEX "LeadAssignment_teamId_idx" ON "LeadAssignment"("teamId");

-- CreateIndex
CREATE INDEX "LeadHelper_leadId_idx" ON "LeadHelper"("leadId");

-- CreateIndex
CREATE INDEX "LeadHelper_accountId_idx" ON "LeadHelper"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadHelper_leadId_accountId_key" ON "LeadHelper"("leadId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadFollowUp_rescheduledToId_key" ON "LeadFollowUp"("rescheduledToId");

-- CreateIndex
CREATE INDEX "LeadFollowUp_leadId_idx" ON "LeadFollowUp"("leadId");

-- CreateIndex
CREATE INDEX "LeadFollowUp_scheduledAt_idx" ON "LeadFollowUp"("scheduledAt");

-- CreateIndex
CREATE INDEX "LeadFollowUp_status_idx" ON "LeadFollowUp"("status");

-- CreateIndex
CREATE INDEX "LeadFollowUp_leadId_status_idx" ON "LeadFollowUp"("leadId", "status");

-- CreateIndex
CREATE INDEX "LeadFollowUp_scheduledAt_status_idx" ON "LeadFollowUp"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "LeadActivityLog_leadId_idx" ON "LeadActivityLog"("leadId");

-- CreateIndex
CREATE INDEX "LeadActivityLog_createdAt_idx" ON "LeadActivityLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_normalizedMobile_key" ON "Customer"("normalizedMobile");

-- CreateIndex
CREATE INDEX "Customer_normalizedMobile_idx" ON "Customer"("normalizedMobile");

-- CreateIndex
CREATE INDEX "Customer_customerCompanyName_idx" ON "Customer"("customerCompanyName");

-- CreateIndex
CREATE INDEX "Customer_tallySerial_idx" ON "Customer"("tallySerial");

-- CreateIndex
CREATE INDEX "Customer_city_idx" ON "Customer"("city");

-- CreateIndex
CREATE INDEX "Customer_state_idx" ON "Customer"("state");

-- CreateIndex
CREATE INDEX "Customer_customerCategory_idx" ON "Customer"("customerCategory");

-- CreateIndex
CREATE INDEX "Customer_businessCategory_idx" ON "Customer"("businessCategory");

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

-- CreateIndex
CREATE INDEX "Customer_isActive_createdAt_idx" ON "Customer"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_accountId_idx" ON "Notification"("accountId");

-- CreateIndex
CREATE INDEX "Notification_category_idx" ON "Notification"("category");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_dedupeKey_idx" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSubscription_endpoint_key" ON "NotificationSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "NotificationSubscription_accountId_idx" ON "NotificationSubscription"("accountId");

-- CreateIndex
CREATE INDEX "MessageTemplate_visibility_idx" ON "MessageTemplate"("visibility");

-- CreateIndex
CREATE INDEX "MessageTemplate_accountId_idx" ON "MessageTemplate"("accountId");

-- CreateIndex
CREATE INDEX "MessageTemplate_isActive_idx" ON "MessageTemplate"("isActive");

-- CreateIndex
CREATE INDEX "MessageTemplate_lastUsedAt_idx" ON "MessageTemplate"("lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_accountId_slug_key" ON "MessageTemplate"("accountId", "slug");

-- CreateIndex
CREATE INDEX "TemplatePreference_accountId_idx" ON "TemplatePreference"("accountId");

-- CreateIndex
CREATE INDEX "TemplatePreference_templateId_idx" ON "TemplatePreference"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplatePreference_accountId_templateId_key" ON "TemplatePreference"("accountId", "templateId");

-- CreateIndex
CREATE INDEX "CheckLog_accountId_date_idx" ON "CheckLog"("accountId", "date");

-- CreateIndex
CREATE INDEX "CheckLog_sessionId_idx" ON "CheckLog"("sessionId");

-- CreateIndex
CREATE INDEX "CheckLog_checkedAt_idx" ON "CheckLog"("checkedAt");

-- CreateIndex
CREATE INDEX "CheckLog_type_idx" ON "CheckLog"("type");

-- CreateIndex
CREATE INDEX "AttendanceLog_date_idx" ON "AttendanceLog"("date");

-- CreateIndex
CREATE INDEX "AttendanceLog_accountId_idx" ON "AttendanceLog"("accountId");

-- CreateIndex
CREATE INDEX "AttendanceLog_status_idx" ON "AttendanceLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLog_accountId_date_key" ON "AttendanceLog"("accountId", "date");

-- CreateIndex
CREATE INDEX "LeaveRequest_accountId_idx" ON "LeaveRequest"("accountId");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "DsuTemplate_teamId_idx" ON "DsuTemplate"("teamId");

-- CreateIndex
CREATE INDEX "DsuTemplate_isActive_idx" ON "DsuTemplate"("isActive");

-- CreateIndex
CREATE INDEX "DsuTemplateVersion_templateId_idx" ON "DsuTemplateVersion"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "DsuTemplateVersion_templateId_version_key" ON "DsuTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "DsuEntry_accountId_idx" ON "DsuEntry"("accountId");

-- CreateIndex
CREATE INDEX "DsuEntry_teamId_idx" ON "DsuEntry"("teamId");

-- CreateIndex
CREATE INDEX "DsuEntry_date_idx" ON "DsuEntry"("date");

-- CreateIndex
CREATE INDEX "DsuEntry_submittedAt_idx" ON "DsuEntry"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DsuEntry_accountId_date_templateId_key" ON "DsuEntry"("accountId", "date", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNumber_key" ON "Quotation"("quotationNumber");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "Quotation_createdBy_idx" ON "Quotation"("createdBy");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_quotationDate_idx" ON "Quotation"("quotationDate");

-- CreateIndex
CREATE INDEX "Quotation_validUntil_idx" ON "Quotation"("validUntil");

-- CreateIndex
CREATE INDEX "Quotation_leadId_idx" ON "Quotation"("leadId");

-- CreateIndex
CREATE INDEX "Quotation_quotationNumber_idx" ON "Quotation"("quotationNumber");

-- CreateIndex
CREATE INDEX "Quotation_parentId_idx" ON "Quotation"("parentId");

-- CreateIndex
CREATE INDEX "QuotationActivity_quotationId_idx" ON "QuotationActivity"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationActivity_performedBy_idx" ON "QuotationActivity"("performedBy");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationSequence_year_month_key" ON "QuotationSequence"("year", "month");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_activeLeadId_fkey" FOREIGN KEY ("activeLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationRequest" ADD CONSTRAINT "RegistrationRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "SalaryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlySalary" ADD CONSTRAINT "MonthlySalary_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlySalary" ADD CONSTRAINT "MonthlySalary_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStatement" ADD CONSTRAINT "SalaryStatement_monthlySalaryId_fkey" FOREIGN KEY ("monthlySalaryId") REFERENCES "MonthlySalary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryNotice" ADD CONSTRAINT "SalaryNotice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryNotice" ADD CONSTRAINT "SalaryNotice_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SalaryRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryNotice" ADD CONSTRAINT "SalaryNotice_monthlySalaryId_fkey" FOREIGN KEY ("monthlySalaryId") REFERENCES "MonthlySalary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetail" ADD CONSTRAINT "BankDetail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusyActivityLog" ADD CONSTRAINT "BusyActivityLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordOTP" ADD CONSTRAINT "PasswordOTP_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCustomField" ADD CONSTRAINT "ProjectCustomField_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCustomFieldValue" ADD CONSTRAINT "TaskCustomFieldValue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCustomFieldValue" ADD CONSTRAINT "TaskCustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ProjectCustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineTemplateStep" ADD CONSTRAINT "PipelineTemplateStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PipelineTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineTemplateTask" ADD CONSTRAINT "PipelineTemplateTask_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineTemplateStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPipeline" ADD CONSTRAINT "ProjectPipeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ProjectPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependentTaskId_fkey" FOREIGN KEY ("dependentTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_blockingTaskId_fkey" FOREIGN KEY ("blockingTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "TaskComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWatcher" ADD CONSTRAINT "TaskWatcher_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWatcher" ADD CONSTRAINT "TaskWatcher_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadHelper" ADD CONSTRAINT "LeadHelper_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadHelper" ADD CONSTRAINT "LeadHelper_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadHelper" ADD CONSTRAINT "LeadHelper_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_rescheduledToId_fkey" FOREIGN KEY ("rescheduledToId") REFERENCES "LeadFollowUp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_doneBy_fkey" FOREIGN KEY ("doneBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivityLog" ADD CONSTRAINT "LeadActivityLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivityLog" ADD CONSTRAINT "LeadActivityLog_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSubscription" ADD CONSTRAINT "NotificationSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplatePreference" ADD CONSTRAINT "TemplatePreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplatePreference" ADD CONSTRAINT "TemplatePreference_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckLog" ADD CONSTRAINT "CheckLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckLog" ADD CONSTRAINT "CheckLog_attendanceLogId_fkey" FOREIGN KEY ("attendanceLogId") REFERENCES "AttendanceLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsuTemplate" ADD CONSTRAINT "DsuTemplate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsuTemplateVersion" ADD CONSTRAINT "DsuTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DsuTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsuEntry" ADD CONSTRAINT "DsuEntry_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DsuTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsuEntry" ADD CONSTRAINT "DsuEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_preparedBy_fkey" FOREIGN KEY ("preparedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationActivity" ADD CONSTRAINT "QuotationActivity_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationActivity" ADD CONSTRAINT "QuotationActivity_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationTemplate" ADD CONSTRAINT "QuotationTemplate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

