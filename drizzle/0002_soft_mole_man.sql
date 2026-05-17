CREATE TABLE `transcript_segments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` int NOT NULL,
	`speechId` int NOT NULL,
	`speakerRole` varchar(64) NOT NULL,
	`speakerName` varchar(255),
	`text` text NOT NULL,
	`timestamp` int NOT NULL,
	`sequenceNumber` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transcript_segments_id` PRIMARY KEY(`id`)
);
