CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`anomalyId` int,
	`alertType` enum('ANOMALY_DETECTED','ENPI_DEVIATION','PDCA_MILESTONE','MAINTENANCE_DUE','THRESHOLD_EXCEEDED') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`isRead` boolean DEFAULT false,
	`emailSent` boolean DEFAULT false,
	`smsSent` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`acknowledgedAt` timestamp,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `anomalies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`timestamp` timestamp NOT NULL,
	`anomalyType` enum('THD_SPIKE','POWER_FACTOR_LOW','CONSUMPTION_DRIFT','OEE_MISMATCH','HARMONIC_DISTORTION','VOLTAGE_SWELL','VOLTAGE_SAG','FREQUENCY_DEVIATION','OTHER') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL,
	`description` text,
	`detectedValue` decimal(12,6),
	`thresholdValue` decimal(12,6),
	`confidence` decimal(5,4),
	`isResolved` boolean DEFAULT false,
	`resolutionNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `anomalies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`action` varchar(128) NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` int NOT NULL,
	`changes` text,
	`reason` text,
	`ipAddress` varchar(45),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `energyBaselines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`baselineType` enum('ratio','regression') NOT NULL,
	`enpiRatioValue` decimal(12,6),
	`regressionCoefficients` text,
	`rSquared` decimal(5,4),
	`normalizationFactors` text,
	`referenceStartDate` timestamp NOT NULL,
	`referenceEndDate` timestamp NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `energyBaselines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `energyPerformanceIndicators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`baselineId` int NOT NULL,
	`timestamp` timestamp NOT NULL,
	`enpiValue` decimal(12,6) NOT NULL,
	`enpiNormalized` decimal(12,6),
	`enpiDeviation` decimal(8,4),
	`improvementProof` decimal(8,4),
	`status` enum('normal','warning','critical') DEFAULT 'normal',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `energyPerformanceIndicators_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`siteId` varchar(64) NOT NULL,
	`machineCode` varchar(64) NOT NULL,
	`machineName` text NOT NULL,
	`machineType` varchar(64),
	`location` text,
	`nominalPower` decimal(10,2),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `machines_id` PRIMARY KEY(`id`),
	CONSTRAINT `machines_machineCode_unique` UNIQUE(`machineCode`)
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`timestamp` timestamp NOT NULL,
	`kWh` decimal(12,4) NOT NULL,
	`kVA` decimal(12,4) NOT NULL,
	`cosPhiVoltage` decimal(5,4),
	`cosPhiCurrent` decimal(5,4),
	`thdVoltage` decimal(6,2),
	`thdCurrent` decimal(6,2),
	`harmonicsJson` text,
	`outputPieces` decimal(12,2),
	`outputTonnage` decimal(12,4),
	`machineState` enum('running','idle','stopped','maintenance') NOT NULL,
	`oee` decimal(5,4),
	`temperature` decimal(6,2),
	`humidity` decimal(5,2),
	`isAnomaly` boolean DEFAULT false,
	`anomalyLabel` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `measurements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modelArtifacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelType` enum('LSTM_PREDICTION','AUTOENCODER_ANOMALY') NOT NULL,
	`modelVersion` varchar(32) NOT NULL,
	`modelPath` text NOT NULL,
	`trainingDatasetSize` int,
	`trainingMetrics` text,
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `modelArtifacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pdcaCycles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`cycleNumber` int NOT NULL,
	`planObjective` text NOT NULL,
	`planTargetEnpi` decimal(12,6),
	`planActions` text,
	`planStartDate` timestamp NOT NULL,
	`doStatus` enum('not_started','in_progress','completed') DEFAULT 'not_started',
	`doActionsLog` text,
	`doCompletionDate` timestamp,
	`checkStatus` enum('not_started','in_progress','completed') DEFAULT 'not_started',
	`checkEnpiAchieved` decimal(12,6),
	`checkImprovementProof` decimal(8,4),
	`checkCompletionDate` timestamp,
	`actStatus` enum('not_started','in_progress','completed') DEFAULT 'not_started',
	`actDecision` enum('approved','rejected','pending') DEFAULT 'pending',
	`actCorrectiveActions` text,
	`actCompletionDate` timestamp,
	`auditTrail` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pdcaCycles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`pdcaCycleId` int,
	`anomalyId` int,
	`recommendationType` enum('MAINTENANCE','OPTIMIZATION','REPLACEMENT','PROCESS_CHANGE','MONITORING') NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`estimatedEnpiReduction` decimal(8,4),
	`confidence` decimal(5,4) NOT NULL,
	`priority` enum('low','medium','high') DEFAULT 'medium',
	`status` enum('pending','approved','in_progress','completed','rejected') DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recommendations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`username` varchar(64) NOT NULL,
	`passwordHash` varchar(128) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64) DEFAULT 'local',
	`role` enum('ADMIN_ENERGIE','RESPONSABLE_SITE','AUDITEUR','OPERATEUR') NOT NULL DEFAULT 'OPERATEUR',
	`failedLoginCount` int NOT NULL DEFAULT 0,
	`isLocked` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `userSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionTokenHash` varchar(128) NOT NULL,
	`issuedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`userAgent` varchar(512),
	`ipAddress` varchar(45),
	CONSTRAINT `userSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `userSessions_token_unique` UNIQUE(`sessionTokenHash`)
);
