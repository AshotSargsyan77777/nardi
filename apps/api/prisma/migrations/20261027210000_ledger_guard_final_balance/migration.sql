-- The deferred guard runs once per UPDATE event at COMMIT; when an account is updated several
-- times in one transaction, NEW holds an intermediate value. Compare the row's *current* balance
-- (as of commit) with the running balance of its latest ledger entry instead.
CREATE OR REPLACE FUNCTION ledger_account_guard() RETURNS trigger AS $$
DECLARE latest BIGINT;
DECLARE cur BIGINT;
BEGIN
  IF NEW."type" <> OLD."type" OR NEW."currency" <> OLD."currency"
     OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."matchId" IS DISTINCT FROM OLD."matchId" THEN
    RAISE EXCEPTION 'Ledger account identity is immutable';
  END IF;
  SELECT "balance" INTO cur FROM "LedgerAccount" WHERE "id" = NEW."id";
  SELECT "balanceAfter" INTO latest FROM "LedgerEntry" WHERE "accountId" = NEW."id" ORDER BY "id" DESC LIMIT 1;
  IF COALESCE(latest, 0) <> cur THEN
    RAISE EXCEPTION 'Balance of account % does not match its ledger (ledger=%, cached=%)', NEW."id", latest, cur
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
