CREATE TYPE "ClubRole" AS ENUM ('OWNER', 'MEMBER');

CREATE TABLE "Club" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameLower" TEXT NOT NULL,
    "emblem" TEXT NOT NULL DEFAULT '🎲',
    "description" TEXT NOT NULL DEFAULT '',
    "ownerId" UUID NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClubMember" (
    "id" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ClubRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Club_nameLower_key" ON "Club"("nameLower");
CREATE UNIQUE INDEX "Club_inviteCode_key" ON "Club"("inviteCode");
CREATE UNIQUE INDEX "ClubMember_clubId_userId_key" ON "ClubMember"("clubId", "userId");
CREATE INDEX "ClubMember_userId_idx" ON "ClubMember"("userId");
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
