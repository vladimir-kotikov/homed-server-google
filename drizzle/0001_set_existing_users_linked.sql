-- Data migration: Set linked=true for all existing users
-- This ensures users created before the linked field was added are marked as linked
UPDATE user SET linked = 1 WHERE linked IS NULL OR linked = 0;
