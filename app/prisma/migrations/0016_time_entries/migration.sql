-- Hours logged against a contract. invoiceId is null until the entry is billed.

CREATE TABLE public."TimeEntry" (
    id uuid NOT NULL,
    "contractId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    date date NOT NULL,
    hours numeric(8,2) NOT NULL,
    description text NOT NULL,
    billable boolean DEFAULT true NOT NULL,
    "invoiceId" uuid,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_hours_positive" CHECK (hours > 0);

CREATE INDEX "TimeEntry_contractId_date_idx" ON public."TimeEntry" USING btree ("contractId", date);

CREATE INDEX "TimeEntry_invoiceId_idx" ON public."TimeEntry" USING btree ("invoiceId");

CREATE INDEX "TimeEntry_userId_idx" ON public."TimeEntry" USING btree ("userId");

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES public."Contract"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE SET NULL;
