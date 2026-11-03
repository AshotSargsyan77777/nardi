-- «Invite a friend»
ALTER TYPE "LedgerTxType" ADD VALUE 'REFERRAL_BONUS';
ALTER TABLE "User" ADD COLUMN "referredById" UUID, ADD COLUMN "referralRewardedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_referredById_idx" ON "User"("referredById");
