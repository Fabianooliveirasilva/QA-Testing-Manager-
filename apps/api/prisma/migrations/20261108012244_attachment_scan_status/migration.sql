-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('NOT_SCANNED', 'CLEAN');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "scan_status" "ScanStatus" NOT NULL DEFAULT 'NOT_SCANNED';
