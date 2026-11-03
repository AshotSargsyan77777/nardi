-- Profile photos
CREATE TABLE "AvatarPhoto" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvatarPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AvatarPhoto_userId_key" ON "AvatarPhoto"("userId");

ALTER TABLE "AvatarPhoto" ADD CONSTRAINT "AvatarPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
