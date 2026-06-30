-- CreateTable: VirtualPresence
CREATE TABLE "VirtualPresence" (
    "id" TEXT NOT NULL,
    "internId" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VirtualPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AvailabilityWindow
CREATE TABLE "AvailabilityWindow" (
    "id" TEXT NOT NULL,
    "internId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "availableFrom" TIME NOT NULL,
    "availableTo" TIME NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AvailabilityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VirtualPresence_internId_idx" ON "VirtualPresence"("internId");
CREATE INDEX "VirtualPresence_checkInAt_idx" ON "VirtualPresence"("checkInAt");
CREATE INDEX "VirtualPresence_internId_checkInAt_idx" ON "VirtualPresence"("internId", "checkInAt");
CREATE INDEX "AvailabilityWindow_internId_idx" ON "AvailabilityWindow"("internId");
CREATE INDEX "AvailabilityWindow_date_idx" ON "AvailabilityWindow"("date");
CREATE UNIQUE INDEX "AvailabilityWindow_internId_date_key" ON "AvailabilityWindow"("internId", "date");

-- AddForeignKey
ALTER TABLE "VirtualPresence" ADD CONSTRAINT "VirtualPresence_internId_fkey"
    FOREIGN KEY ("internId") REFERENCES "Intern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AvailabilityWindow" ADD CONSTRAINT "AvailabilityWindow_internId_fkey"
    FOREIGN KEY ("internId") REFERENCES "Intern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
