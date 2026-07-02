/*
  Warnings:

  - You are about to drop the `tenant` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "tenant";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaConfigs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "max_requests" INTEGER NOT NULL DEFAULT 100,
    "window_seconds" INTEGER NOT NULL DEFAULT 60,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaConfigs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_name_key" ON "Tenant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_api_key_key" ON "Tenant"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaConfigs_tenantId_key" ON "QuotaConfigs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationLog_request_id_key" ON "ViolationLog"("request_id");

-- AddForeignKey
ALTER TABLE "QuotaConfigs" ADD CONSTRAINT "QuotaConfigs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationLog" ADD CONSTRAINT "ViolationLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
