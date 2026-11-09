-- Enum values must be committed before a later migration uses the new value.
ALTER TYPE "EmptiesMovementType" ADD VALUE 'ISSUED_TO_CUSTOMER';
