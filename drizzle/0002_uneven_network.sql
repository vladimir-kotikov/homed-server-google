CREATE TABLE `device` (
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`device_id` text NOT NULL,
	`device_data` text NOT NULL,
	`last_seen` integer NOT NULL,
	`available` integer DEFAULT true,
	PRIMARY KEY(`user_id`, `client_id`, `device_id`)
);
