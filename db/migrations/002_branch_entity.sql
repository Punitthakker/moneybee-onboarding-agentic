-- Phase 2: branch of a UAE or foreign company is a supported company type (optional SQL Server engine only).
ALTER TABLE dbo.merchants DROP CONSTRAINT CK_merchants_entity;
GO
ALTER TABLE dbo.merchants ADD CONSTRAINT CK_merchants_entity CHECK (entity_type IN ('sole_establishment','llc','free_zone','mainland','branch'));
GO
