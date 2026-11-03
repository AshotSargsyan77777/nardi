-- Look-alike nickname check (filled by the API on start)
ALTER TABLE "User" ADD COLUMN "nicknameSkeleton" TEXT;

CREATE INDEX "User_nicknameSkeleton_idx" ON "User"("nicknameSkeleton");
