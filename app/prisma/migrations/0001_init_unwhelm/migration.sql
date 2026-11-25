--
-- PostgreSQL database dump
--

\restrict IgUtop1dZYLWgzuvfQYfgSjzvr3Zg2cezDuOmgrdrZEE4N8QR3MbHARFizYdyQu

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg13+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ApprovalKind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApprovalKind" AS ENUM (
    'pricing',
    'change_order'
);


--
-- Name: ApprovalStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApprovalStatus" AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: BillingTrigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."BillingTrigger" AS ENUM (
    'contract_signed',
    'milestone_accepted',
    'manual'
);


--
-- Name: ChangeOrderStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChangeOrderStatus" AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: ChatAgent; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChatAgent" AS ENUM (
    'proposal',
    'contract',
    'project_manager'
);


--
-- Name: ChatRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChatRole" AS ENUM (
    'user',
    'assistant',
    'human',
    'system'
);


--
-- Name: ChatStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChatStatus" AS ENUM (
    'open',
    'human_held',
    'closed'
);


--
-- Name: ContractStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ContractStatus" AS ENUM (
    'draft',
    'sent',
    'signed',
    'cancelled'
);


--
-- Name: EngagementKind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."EngagementKind" AS ENUM (
    'workflow_check',
    'capped_hours_4',
    'capped_hours_8',
    'fixed_price'
);


--
-- Name: EscalationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."EscalationStatus" AS ENUM (
    'open',
    'claimed',
    'resolved'
);


--
-- Name: InvoiceStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InvoiceStatus" AS ENUM (
    'draft',
    'sent',
    'paid',
    'void'
);


--
-- Name: MembershipStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MembershipStatus" AS ENUM (
    'invited',
    'active',
    'suspended'
);


--
-- Name: MilestoneStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MilestoneStatus" AS ENUM (
    'planned',
    'in_progress',
    'submitted',
    'accepted',
    'blocked'
);


--
-- Name: ProjectStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProjectStatus" AS ENUM (
    'planned',
    'active',
    'blocked',
    'complete'
);


--
-- Name: RecordStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RecordStatus" AS ENUM (
    'draft',
    'pending_approval',
    'active',
    'on_hold',
    'closed'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'prospect',
    'client',
    'staff'
);


--
-- Name: TaskStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TaskStatus" AS ENUM (
    'todo',
    'in_progress',
    'blocked',
    'done'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Approval; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Approval" (
    id uuid NOT NULL,
    kind public."ApprovalKind" NOT NULL,
    "recordId" uuid NOT NULL,
    status public."ApprovalStatus" DEFAULT 'pending'::public."ApprovalStatus" NOT NULL,
    "decidedBy" uuid,
    reason text,
    "decidedAt" timestamp(3) without time zone
);


--
-- Name: AuditEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditEvent" (
    id uuid NOT NULL,
    "organizationId" uuid,
    "actorUserId" uuid,
    "tokenId" uuid,
    operation text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    "recordType" text,
    "recordId" uuid,
    "requestId" text NOT NULL,
    "inputRedacted" jsonb NOT NULL,
    "statusCode" integer NOT NULL,
    "previousHash" text,
    hash text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: BillingEntry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BillingEntry" (
    id uuid NOT NULL,
    "contractId" uuid NOT NULL,
    label text NOT NULL,
    percent numeric(8,4) NOT NULL,
    "amountMinor" integer NOT NULL,
    currency text NOT NULL,
    "dueOn" timestamp(3) without time zone,
    trigger public."BillingTrigger" NOT NULL,
    "invoiceId" uuid
);


--
-- Name: ChangeOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ChangeOrder" (
    id uuid NOT NULL,
    "contractId" uuid NOT NULL,
    "requestedBy" uuid NOT NULL,
    summary text NOT NULL,
    "priceDeltaMinor" integer,
    "priceCurrency" text,
    status public."ChangeOrderStatus" DEFAULT 'pending'::public."ChangeOrderStatus" NOT NULL
);


--
-- Name: ChatMessage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ChatMessage" (
    id uuid NOT NULL,
    "sessionId" uuid NOT NULL,
    role public."ChatRole" NOT NULL,
    content text NOT NULL,
    "toolCallId" uuid,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ChatSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ChatSession" (
    id uuid NOT NULL,
    "ownerId" uuid,
    agent public."ChatAgent" NOT NULL,
    status public."ChatStatus" DEFAULT 'open'::public."ChatStatus" NOT NULL,
    "proposalId" uuid,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Contract; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Contract" (
    id uuid NOT NULL,
    "proposalId" uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    status public."ContractStatus" DEFAULT 'draft'::public."ContractStatus" NOT NULL,
    terms text NOT NULL,
    billing jsonb NOT NULL,
    "signedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Escalation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Escalation" (
    id uuid NOT NULL,
    "sessionId" uuid NOT NULL,
    reason text NOT NULL,
    status public."EscalationStatus" DEFAULT 'open'::public."EscalationStatus" NOT NULL,
    "assigneeId" uuid,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resolvedAt" timestamp(3) without time zone
);


--
-- Name: IdempotencyKey; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."IdempotencyKey" (
    id uuid NOT NULL,
    "organizationId" uuid,
    "userId" uuid,
    "requestId" text NOT NULL,
    operation text NOT NULL,
    response jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone
);


--
-- Name: Invoice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Invoice" (
    id uuid NOT NULL,
    "contractId" uuid NOT NULL,
    "amountMinor" integer NOT NULL,
    currency text NOT NULL,
    status public."InvoiceStatus" DEFAULT 'draft'::public."InvoiceStatus" NOT NULL,
    "dueDate" timestamp(3) without time zone NOT NULL,
    "paidAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: McpClient; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."McpClient" (
    id uuid NOT NULL,
    "organizationId" uuid,
    "clientId" text NOT NULL,
    name text NOT NULL,
    "redirectUris" jsonb DEFAULT '[]'::jsonb NOT NULL,
    scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    "secretHash" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: McpToken; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."McpToken" (
    id uuid NOT NULL,
    "clientId" uuid NOT NULL,
    "tokenHash" text NOT NULL,
    scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Membership" (
    id uuid NOT NULL,
    "userId" uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    role public."Role" NOT NULL,
    status public."MembershipStatus" DEFAULT 'invited'::public."MembershipStatus" NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: Milestone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Milestone" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    "dueDate" timestamp(3) without time zone,
    status public."MilestoneStatus" DEFAULT 'planned'::public."MilestoneStatus" NOT NULL,
    "retainageMinor" integer,
    "retainageCurrency" text
);


--
-- Name: Organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Organization" (
    id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Project; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Project" (
    id uuid NOT NULL,
    "contractId" uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    title text NOT NULL,
    status public."ProjectStatus" DEFAULT 'planned'::public."ProjectStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Proposal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Proposal" (
    id uuid NOT NULL,
    "organizationId" uuid,
    "ownerId" uuid NOT NULL,
    title text NOT NULL,
    engagement public."EngagementKind" NOT NULL,
    status public."RecordStatus" DEFAULT 'draft'::public."RecordStatus" NOT NULL,
    scope jsonb NOT NULL,
    timeline jsonb NOT NULL,
    budget jsonb NOT NULL,
    "priceAmountMinor" integer,
    "priceCurrency" text,
    version integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ProposalOption; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProposalOption" (
    id uuid NOT NULL,
    "proposalId" uuid NOT NULL,
    label text NOT NULL,
    description text NOT NULL,
    "priceDeltaMinor" integer NOT NULL,
    "priceCurrency" text NOT NULL,
    selected boolean DEFAULT false NOT NULL
);


--
-- Name: Task; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Task" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    "milestoneId" uuid,
    title text NOT NULL,
    description text NOT NULL,
    status public."TaskStatus" DEFAULT 'todo'::public."TaskStatus" NOT NULL,
    "assigneeId" uuid,
    "dueDate" timestamp(3) without time zone
);


--
-- Name: TimelineMilestone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TimelineMilestone" (
    id uuid NOT NULL,
    "proposalId" uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    "dueDate" timestamp(3) without time zone
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id uuid NOT NULL,
    email text NOT NULL,
    "displayName" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Approval Approval_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Approval"
    ADD CONSTRAINT "Approval_pkey" PRIMARY KEY (id);


--
-- Name: AuditEvent AuditEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_pkey" PRIMARY KEY (id);


--
-- Name: BillingEntry BillingEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BillingEntry"
    ADD CONSTRAINT "BillingEntry_pkey" PRIMARY KEY (id);


--
-- Name: ChangeOrder ChangeOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChangeOrder"
    ADD CONSTRAINT "ChangeOrder_pkey" PRIMARY KEY (id);


--
-- Name: ChatMessage ChatMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_pkey" PRIMARY KEY (id);


--
-- Name: ChatSession ChatSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatSession"
    ADD CONSTRAINT "ChatSession_pkey" PRIMARY KEY (id);


--
-- Name: Contract Contract_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_pkey" PRIMARY KEY (id);


--
-- Name: Escalation Escalation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Escalation"
    ADD CONSTRAINT "Escalation_pkey" PRIMARY KEY (id);


--
-- Name: IdempotencyKey IdempotencyKey_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."IdempotencyKey"
    ADD CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY (id);


--
-- Name: Invoice Invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_pkey" PRIMARY KEY (id);


--
-- Name: McpClient McpClient_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."McpClient"
    ADD CONSTRAINT "McpClient_pkey" PRIMARY KEY (id);


--
-- Name: McpToken McpToken_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."McpToken"
    ADD CONSTRAINT "McpToken_pkey" PRIMARY KEY (id);


--
-- Name: Membership Membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_pkey" PRIMARY KEY (id);


--
-- Name: Milestone Milestone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Milestone"
    ADD CONSTRAINT "Milestone_pkey" PRIMARY KEY (id);


--
-- Name: Organization Organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);


--
-- Name: Project Project_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_pkey" PRIMARY KEY (id);


--
-- Name: ProposalOption ProposalOption_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProposalOption"
    ADD CONSTRAINT "ProposalOption_pkey" PRIMARY KEY (id);


--
-- Name: Proposal Proposal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Proposal"
    ADD CONSTRAINT "Proposal_pkey" PRIMARY KEY (id);


--
-- Name: Task Task_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Task"
    ADD CONSTRAINT "Task_pkey" PRIMARY KEY (id);


--
-- Name: TimelineMilestone TimelineMilestone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TimelineMilestone"
    ADD CONSTRAINT "TimelineMilestone_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Approval_kind_recordId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Approval_kind_recordId_status_idx" ON public."Approval" USING btree (kind, "recordId", status);


--
-- Name: AuditEvent_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON public."AuditEvent" USING btree ("organizationId", "createdAt");


--
-- Name: AuditEvent_recordType_recordId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditEvent_recordType_recordId_createdAt_idx" ON public."AuditEvent" USING btree ("recordType", "recordId", "createdAt");


--
-- Name: BillingEntry_contractId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BillingEntry_contractId_idx" ON public."BillingEntry" USING btree ("contractId");


--
-- Name: ChangeOrder_contractId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ChangeOrder_contractId_status_idx" ON public."ChangeOrder" USING btree ("contractId", status);


--
-- Name: ChatMessage_sessionId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON public."ChatMessage" USING btree ("sessionId", "createdAt");


--
-- Name: ChatSession_ownerId_status_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ChatSession_ownerId_status_updatedAt_idx" ON public."ChatSession" USING btree ("ownerId", status, "updatedAt");


--
-- Name: Contract_organizationId_status_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Contract_organizationId_status_updatedAt_idx" ON public."Contract" USING btree ("organizationId", status, "updatedAt");


--
-- Name: Escalation_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Escalation_status_createdAt_idx" ON public."Escalation" USING btree (status, "createdAt");


--
-- Name: IdempotencyKey_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IdempotencyKey_expiresAt_idx" ON public."IdempotencyKey" USING btree ("expiresAt");


--
-- Name: IdempotencyKey_organizationId_requestId_operation_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IdempotencyKey_organizationId_requestId_operation_key" ON public."IdempotencyKey" USING btree ("organizationId", "requestId", operation);


--
-- Name: Invoice_contractId_status_dueDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Invoice_contractId_status_dueDate_idx" ON public."Invoice" USING btree ("contractId", status, "dueDate");


--
-- Name: McpClient_clientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "McpClient_clientId_key" ON public."McpClient" USING btree ("clientId");


--
-- Name: McpToken_clientId_revokedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "McpToken_clientId_revokedAt_idx" ON public."McpToken" USING btree ("clientId", "revokedAt");


--
-- Name: McpToken_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "McpToken_tokenHash_key" ON public."McpToken" USING btree ("tokenHash");


--
-- Name: Membership_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Membership_organizationId_status_idx" ON public."Membership" USING btree ("organizationId", status);


--
-- Name: Membership_userId_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON public."Membership" USING btree ("userId", "organizationId");


--
-- Name: Milestone_projectId_status_dueDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Milestone_projectId_status_dueDate_idx" ON public."Milestone" USING btree ("projectId", status, "dueDate");


--
-- Name: Organization_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Organization_slug_key" ON public."Organization" USING btree (slug);


--
-- Name: Project_organizationId_status_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Project_organizationId_status_updatedAt_idx" ON public."Project" USING btree ("organizationId", status, "updatedAt");


--
-- Name: ProposalOption_proposalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProposalOption_proposalId_idx" ON public."ProposalOption" USING btree ("proposalId");


--
-- Name: Proposal_organizationId_status_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Proposal_organizationId_status_updatedAt_idx" ON public."Proposal" USING btree ("organizationId", status, "updatedAt");


--
-- Name: Task_projectId_status_dueDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Task_projectId_status_dueDate_idx" ON public."Task" USING btree ("projectId", status, "dueDate");


--
-- Name: TimelineMilestone_proposalId_dueDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TimelineMilestone_proposalId_dueDate_idx" ON public."TimelineMilestone" USING btree ("proposalId", "dueDate");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: Approval Approval_decidedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Approval"
    ADD CONSTRAINT "Approval_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AuditEvent AuditEvent_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AuditEvent AuditEvent_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: BillingEntry BillingEntry_contractId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BillingEntry"
    ADD CONSTRAINT "BillingEntry_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES public."Contract"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BillingEntry BillingEntry_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BillingEntry"
    ADD CONSTRAINT "BillingEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ChangeOrder ChangeOrder_contractId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChangeOrder"
    ADD CONSTRAINT "ChangeOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES public."Contract"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChangeOrder ChangeOrder_requestedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChangeOrder"
    ADD CONSTRAINT "ChangeOrder_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ChatMessage ChatMessage_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public."ChatSession"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatSession ChatSession_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatSession"
    ADD CONSTRAINT "ChatSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ChatSession ChatSession_proposalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatSession"
    ADD CONSTRAINT "ChatSession_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES public."Proposal"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Contract Contract_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Contract Contract_proposalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES public."Proposal"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Escalation Escalation_assigneeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Escalation"
    ADD CONSTRAINT "Escalation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Escalation Escalation_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Escalation"
    ADD CONSTRAINT "Escalation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public."ChatSession"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Invoice Invoice_contractId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES public."Contract"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: McpClient McpClient_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."McpClient"
    ADD CONSTRAINT "McpClient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: McpToken McpToken_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."McpToken"
    ADD CONSTRAINT "McpToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."McpClient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Membership Membership_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Membership Membership_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Milestone Milestone_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Milestone"
    ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Project Project_contractId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES public."Contract"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Project Project_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ProposalOption ProposalOption_proposalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProposalOption"
    ADD CONSTRAINT "ProposalOption_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES public."Proposal"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Proposal Proposal_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Proposal"
    ADD CONSTRAINT "Proposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Proposal Proposal_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Proposal"
    ADD CONSTRAINT "Proposal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Task Task_assigneeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Task"
    ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Task Task_milestoneId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Task"
    ADD CONSTRAINT "Task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES public."Milestone"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Task Task_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Task"
    ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TimelineMilestone TimelineMilestone_proposalId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TimelineMilestone"
    ADD CONSTRAINT "TimelineMilestone_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES public."Proposal"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict IgUtop1dZYLWgzuvfQYfgSjzvr3Zg2cezDuOmgrdrZEE4N8QR3MbHARFizYdyQu


