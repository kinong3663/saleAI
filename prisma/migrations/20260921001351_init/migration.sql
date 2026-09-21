-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('CUSTOMER', 'SALES', 'SYSTEM');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "salesGoal" TEXT NOT NULL,
    "tone" TEXT,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "turnId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "clientMsgId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_states" (
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadStage" TEXT NOT NULL DEFAULT 'NEW',
    "intent" TEXT,
    "needHuman" BOOLEAN NOT NULL DEFAULT false,
    "humanReason" TEXT,
    "humanResolvedAt" TIMESTAMPTZ(3),
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "lastFollowUpAt" TIMESTAMPTZ(3),
    "lastCustomerMessageAt" TIMESTAMPTZ(3),
    "lastSalesMessageAt" TIMESTAMPTZ(3),
    "lastActivityAt" TIMESTAMPTZ(3),
    "lastAnalysisAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_states_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "triggerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "inputDigest" JSONB NOT NULL,
    "rawOutput" TEXT,
    "output" JSONB,
    "rulesHit" TEXT NOT NULL DEFAULT '',
    "guardrailIssues" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "suggestionSent" BOOLEAN NOT NULL DEFAULT false,
    "suggestionEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "customers_tenantId_archivedAt_updatedAt_idx" ON "customers"("tenantId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_externalId_key" ON "customers"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "messages_tenantId_customerId_createdAt_idx" ON "messages"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_customerId_turnId_idx" ON "messages"("customerId", "turnId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_customerId_clientMsgId_key" ON "messages"("customerId", "clientMsgId");

-- CreateIndex
CREATE INDEX "customer_states_tenantId_leadStage_needHuman_idx" ON "customer_states"("tenantId", "leadStage", "needHuman");

-- CreateIndex
CREATE INDEX "customer_states_tenantId_lastActivityAt_idx" ON "customer_states"("tenantId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "agent_runs_tenantId_customerId_createdAt_idx" ON "agent_runs"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_tenantId_status_createdAt_idx" ON "agent_runs"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_customerId_triggerMessageId_key" ON "agent_runs"("customerId", "triggerMessageId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_states" ADD CONSTRAINT "customer_states_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_states" ADD CONSTRAINT "customer_states_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
