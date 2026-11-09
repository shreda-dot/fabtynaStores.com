CREATE TYPE "DrawingPurpose" AS ENUM (
  'SCHOOL_FEES', 'SCHOOL_NEEDS', 'MEDICAL', 'TRANSPORT',
  'FEEDING', 'HOUSEHOLD', 'PERSONAL', 'OTHER'
);

CREATE TABLE family_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  relationship TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT ck_family_members_name CHECK (length(btrim(name)) BETWEEN 1 AND 120 AND name = btrim(name)),
  CONSTRAINT ck_family_members_normalized_key CHECK ("normalizedKey" = lower(name)),
  CONSTRAINT ck_family_members_relationship CHECK (length(btrim(relationship)) BETWEEN 1 AND 120 AND relationship = btrim(relationship))
);

CREATE UNIQUE INDEX "family_members_normalizedKey_key" ON family_members ("normalizedKey");

CREATE TABLE drawings (
  id TEXT PRIMARY KEY,
  "entryId" TEXT NOT NULL,
  "beneficiaryId" TEXT NOT NULL,
  purpose "DrawingPurpose" NOT NULL,
  "sourceExpenseId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drawings_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES account_ledger_entries(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drawings_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES family_members(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drawings_sourceExpenseId_fkey" FOREIGN KEY ("sourceExpenseId") REFERENCES expenses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drawings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "drawings_entryId_key" ON drawings ("entryId");
CREATE UNIQUE INDEX "drawings_sourceExpenseId_key" ON drawings ("sourceExpenseId");
CREATE INDEX "drawings_beneficiaryId_purpose_idx" ON drawings ("beneficiaryId", purpose);

CREATE FUNCTION fn_drawing_check_entry() RETURNS trigger AS $$
DECLARE linked account_ledger_entries%ROWTYPE;
BEGIN
  SELECT * INTO linked FROM account_ledger_entries WHERE id = NEW."entryId";
  IF NOT FOUND OR linked.type <> 'OWNER_DRAWING' OR linked."reversesEntryId" IS NOT NULL OR linked."amountKobo" >= 0 THEN
    RAISE EXCEPTION 'A drawing must reference an original owner drawing entry.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_drawing_check_entry BEFORE INSERT ON drawings
  FOR EACH ROW EXECUTE FUNCTION fn_drawing_check_entry();
CREATE TRIGGER trg_drawing_immutable BEFORE UPDATE OR DELETE ON drawings
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_drawing_no_truncate BEFORE TRUNCATE ON drawings
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_family_member_no_delete BEFORE DELETE ON family_members
  FOR EACH ROW EXECUTE FUNCTION fn_raise_immutable();
CREATE TRIGGER trg_family_member_no_truncate BEFORE TRUNCATE ON family_members
  FOR EACH STATEMENT EXECUTE FUNCTION fn_raise_immutable();

CREATE FUNCTION fn_account_drawing_requires_document() RETURNS trigger AS $$
BEGIN
  IF NEW.type = 'OWNER_DRAWING' AND NEW."reversesEntryId" IS NULL
     AND NOT EXISTS (SELECT 1 FROM drawings WHERE "entryId" = NEW.id) THEN
    RAISE EXCEPTION 'New owner drawing entries require a drawing document.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_account_drawing_requires_document
  AFTER INSERT ON account_ledger_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_account_drawing_requires_document();
