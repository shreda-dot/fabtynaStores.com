\set ON_ERROR_STOP on

BEGIN READ ONLY;

\echo Configured endpoint: :target_host
\echo Production endpoint for comparison: :production_host
\conninfo

SELECT lower(replace(:'target_host', '-pooler.', '.'))
       <> lower(replace(:'production_host', '-pooler.', '.'))
       OR :'allow_production' = 'OWNER_CONFIRMED'
       AS rehearsal_host_differs
\gset
\if :rehearsal_host_differs
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

WITH movement_totals AS (
  SELECT "typeId", SUM(quantity)::bigint AS movement_quantity
    FROM empties_movements
   GROUP BY "typeId"
),
state AS (
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
    LEFT JOIN movement_totals m ON m."typeId" = t.id
),
fingerprint AS (
  SELECT md5(
    current_database() || E'\n'
    || lower(replace(:'target_host', '-pooler.', '.')) || E'\n'
    || COALESCE(
      jsonb_agg(
        jsonb_build_array(
          owner_id, owner_name, owner_active,
          type_id, kind, label, type_active,
          current_balance, movement_total
        )
        ORDER BY type_id
      )::text,
      '[]'
    )
  ) AS value
    FROM state
)
SELECT current_database() AS database_name,
       :'target_host' AS configured_host,
       inet_server_addr()::text AS server_address,
       (SELECT COUNT(*) FROM empties_types) AS type_count,
       value AS input_fingerprint
  FROM fingerprint;

WITH movement_totals AS (
  SELECT "typeId", SUM(quantity)::bigint AS movement_quantity
    FROM empties_movements
   GROUP BY "typeId"
)
SELECT o.name AS brewery,
       o."isActive" AS owner_active,
       t.id AS type_id,
       t.kind::text AS kind,
       t.label,
       t."isActive" AS type_active,
       COALESCE(b.quantity, 0)::bigint AS current_balance,
       COALESCE(m.movement_quantity, 0)::bigint AS movement_total,
       0::bigint AS resulting_balance,
       COALESCE(b.quantity, 0)::bigint
         = COALESCE(m.movement_quantity, 0)::bigint AS balance_matches_ledger
  FROM empties_types t
  JOIN empties_owners o ON o.id = t."ownerId"
  LEFT JOIN empties_balances b ON b."typeId" = t.id
  LEFT JOIN movement_totals m ON m."typeId" = t.id
 WHERE COALESCE(b.quantity, 0) <> 0
    OR COALESCE(b.quantity, 0)::bigint
         <> COALESCE(m.movement_quantity, 0)::bigint
 ORDER BY o.name, t.kind, t.label, t.id;

COMMIT;
