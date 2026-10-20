-- Server-generated sale references (S-YYYYMMDD-000123).
--
-- `sales.reference` is unique but had no generator. The API takes the numeric
-- part from this sequence, so two concurrent requests can never be handed the
-- same reference. A sequence is deliberately not transactional: a rolled-back
-- sale leaves a gap in the numbering, which is acceptable for a reference and
-- is the price of never blocking one sale on another.
CREATE SEQUENCE "sale_reference_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
