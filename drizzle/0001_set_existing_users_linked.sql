ALTER TABLE user ADD COLUMN `linked` integer DEFAULT false;
--> statement-breakpoint
UPDATE user SET linked = 1 WHERE linked IS NULL OR linked = 0;
