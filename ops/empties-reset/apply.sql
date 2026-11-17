\set ON_ERROR_STOP on

\echo Configured endpoint: :target_host
\echo Production endpoint for comparison: :production_host
\conninfo

SELECT lower(replace(:'target_host', '-pooler.', '.'))
       <> lower(replace(:'production_host', '-pooler.', '.'))
       OR :'allow_production' = 'OWNER_CONFIRMED'
       AS target_allowed
\gset
\if :target_allowed
\else
\echo ERROR: endpoint matches production; owner confirmation is required.
\quit 3
\endif

SELECT current_database() = :'expected_database' AS expected_database_matches
\gset
\if :expected_database_matches
\else
\echo ERROR: connected database does not match expected_database.
\quit 3
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE empties_owners, empties_types, empties_balances,
           empties_movements, audit_logs
  IN SHARE ROW EXCLUSIVE MODE;

SET LOCAL fabtyna_reset.target_host = :'target_host';
SET LOCAL fabtyna_reset.production_host = :'production_host';
SET LOCAL fabtyna_reset.expected_database = :'expected_database';
SET LOCAL fabtyna_reset.expected_fingerprint = :'expected_fingerprint';
SET LOCAL fabtyna_reset.actor_id = :'actor_id';
SET LOCAL fabtyna_reset.allow_production = :'allow_production';

DO $reset$
DECLARE
  target_host text := current_setting('fabtyna_reset.target_host');
  production_host text := current_setting('fabtyna_reset.production_host');
  expected_database text := current_setting('fabtyna_reset.expected_database');
  expected_fingerprint text := current_setting('fabtyna_reset.expected_fingerprint');
  actor_id text := current_setting('fabtyna_reset.actor_id');
  allow_production text := current_setting('fabtyna_reset.allow_production');
  current_fingerprint text;
  marker_data jsonb;
  movement_row record;
  movement_id text;
  adjustment_count integer := 0;
  reason constant text := 'pre-launch reset, owner recounting by hand';
BEGIN
  IF current_database() <> expected_database THEN
    RAISE EXCEPTION 'Reset refused: connected database does not match the reviewed database.';
  END IF;

  IF lower(replace(target_host, '-pooler.', '.'))
       = lower(replace(production_host, '-pooler.', '.'))
     AND allow_production <> 'OWNER_CONFIRMED' THEN
    RAISE EXCEPTION 'Reset refused: target endpoint matches the production endpoint.';
  END IF;

  IF target_host = '' OR expected_fingerprint !~ '^[0-9a-f]{32}$' OR actor_id = '' THEN
    RAISE EXCEPTION 'Reset refused: endpoint, reviewed fingerprint, or admin ID is missing or invalid.';
  END IF;

  SELECT "afterData"
    INTO marker_data
    FROM audit_logs
   WHERE action = 'EMPTIES_PRELAUNCH_RESET_APPLIED'
     AND "entityType" = 'EmptiesReset'
     AND "entityId" = 'size-class-prelaunch-v1'
   ORDER BY "occurredAt" DESC
   LIMIT 1;

  IF FOUND THEN
    IF marker_data ->> 'inputFingerprint' IS DISTINCT FROM expected_fingerprint THEN
      RAISE EXCEPTION 'Reset refused: the one-time marker belongs to a different reviewed fingerprint.';
    END IF;
    RAISE NOTICE 'Reset already applied for this fingerprint; no rows changed.';
    RETURN;
  END IF;

  PERFORM 1
    FROM admin_users
   WHERE id = actor_id AND "isActive" = TRUE
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reset refused: the supplied audit actor is not an active admin.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM empties_types t
      LEFT JOIN empties_balances b ON b."typeId" = t.id
      LEFT JOIN (
        SELECT "typeId", SUM(quantity)::bigint AS movement_quantity
          FROM empties_movements
         GROUP BY "typeId"
      ) m ON m."typeId" = t.id
     WHERE COALESCE(b.quantity, 0)::bigint
             <> COALESCE(m.movement_quantity, 0)::bigint
  ) THEN
    RAISE EXCEPTION 'Reset refused: an empties balance differs from its immutable movement ledger.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM empties_types t
      JOIN empties_owners o ON o.id = t."ownerId"
      LEFT JOIN empties_balances b ON b."typeId" = t.id
     WHERE COALESCE(b.quantity, 0) <> 0
       AND (t."isActive" = FALSE OR o."isActive" = FALSE)
  ) THEN
    RAISE EXCEPTION 'Reset refused: a nonzero balance belongs to an inactive empties type or brewery.';
  END IF;

  SELECT md5(
    current_database() || E'\n'
    || lower(replace(target_host, '-pooler.', '.')) || E'\n'
    || COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_array(
            s.owner_id, s.owner_name, s.owner_active,
            s.type_id, s.kind, s.label, s.type_active,
            s.current_balance, s.movement_total
          )
          ORDER BY s.type_id
        )::text
          FROM (
            SELECT o.id AS owner_id,
                   o.name AS owner_name,
                   o."isActive" AS owner_active,
                   t.id AS type_id,
                   t.kind::text AS kind,
                   t.label,
                   t."isActive" AS type_active,
                   COALESCE(b.quantity, 0)::bigint AS current_balance,
                   COALESCE(m.movement_quantity, 0)::bigint AS movement_total
              FROM empties_types t
              JOIN empties_owners o ON o.id = t."ownerId"
              LEFT JOIN empties_balances b ON b."typeId" = t.id
              LEFT JOIN (
                SELECT "typeId", SUM(quantity)::bigint AS movement_quantity
                  FROM empties_movements
                 GROUP BY "typeId"
              ) m ON m."typeId" = t.id
          ) s
      ),
      '[]'
    )
  )
    INTO current_fingerprint;

  IF current_fingerprint IS DISTINCT FROM expected_fingerprint THEN
    RAISE EXCEPTION 'Reset refused: empties state changed after the read-only report. Generate a new report.';
  END IF;

  FOR movement_row IN
    SELECT o.id AS owner_id,
           o.name AS owner_name,
           t.id AS type_id,
           t.kind::text AS kind,
           t.label,
           b.quantity AS current_balance
      FROM empties_types t
      JOIN empties_owners o ON o.id = t."ownerId"
      JOIN empties_balances b ON b."typeId" = t.id
     WHERE b.quantity <> 0
     ORDER BY t.id
  LOOP
    movement_id := md5(
      clock_timestamp()::text || random()::text || txid_current()::text || movement_row.type_id
    );

    INSERT INTO empties_movements
      (id, "typeId", "movementType", quantity, note, "createdById")
    VALUES
      (movement_id, movement_row.type_id, 'ADJUSTMENT',
       -movement_row.current_balance, reason, actor_id);

    INSERT INTO audit_logs
      (id, "actorId", action, "entityType", "entityId", "beforeData", "afterData", metadata)
    VALUES
      (
        md5(clock_timestamp()::text || random()::text || txid_current()::text || movement_id),
        actor_id,
        'EMPTIES_PRELAUNCH_RESET_ADJUSTMENT',
        'EmptiesMovement',
        movement_id,
        jsonb_build_object('quantity', movement_row.current_balance),
        jsonb_build_object(
          'typeId', movement_row.type_id,
          'brewery', movement_row.owner_name,
          'kind', movement_row.kind,
          'label', movement_row.label,
          'movementQuantity', -movement_row.current_balance,
          'resultingBalance', 0,
          'reason', reason
        ),
        jsonb_build_object('inputFingerprint', expected_fingerprint, 'reason', reason)
      );

    adjustment_count := adjustment_count + 1;
  END LOOP;

  INSERT INTO audit_logs
    (id, "actorId", action, "entityType", "entityId", "beforeData", "afterData", metadata)
  VALUES
    (
      md5(clock_timestamp()::text || random()::text || txid_current()::text || 'reset-marker'),
      actor_id,
      'EMPTIES_PRELAUNCH_RESET_APPLIED',
      'EmptiesReset',
      'size-class-prelaunch-v1',
      NULL,
      jsonb_build_object(
        'inputFingerprint', expected_fingerprint,
        'adjustmentCount', adjustment_count,
        'reason', reason
      ),
      jsonb_build_object(
        'targetDatabase', current_database(),
        'targetHost', target_host,
        'inputFingerprint', expected_fingerprint,
        'reason', reason
      )
    );

  RAISE NOTICE 'Reset complete: % adjustment(s); only movement and audit rows were inserted.',
    adjustment_count;
END
$reset$;

COMMIT;
