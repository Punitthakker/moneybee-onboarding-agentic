-- MoneyBee Onboard - SQL Server system of record (initial schema)
-- Statements are separated by lines containing only GO.


CREATE TABLE dbo.merchants (
  id                       UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_merchants PRIMARY KEY,
  legal_name               NVARCHAR(300)    NOT NULL,
  trade_name               NVARCHAR(300)    NULL,
  entity_type              VARCHAR(30)      NOT NULL CONSTRAINT CK_merchants_entity CHECK (entity_type IN ('sole_establishment','llc','free_zone','mainland')),
  licence_no               NVARCHAR(60)     NOT NULL,
  licence_authority        NVARCHAR(200)    NULL,
  licence_expiry           DATE             NULL,
  incorporation_date       DATE             NULL,
  trn                      VARCHAR(20)      NULL,
  registered_address       NVARCHAR(600)    NULL,
  website                  NVARCHAR(300)    NULL,
  mcc                      VARCHAR(4)       NULL,
  expected_monthly_volume  DECIMAL(18,2)    NULL,
  expected_avg_ticket      DECIMAL(18,2)    NULL,
  risk_rating              VARCHAR(10)      NULL CONSTRAINT CK_merchants_risk CHECK (risk_rating IS NULL OR risk_rating IN ('LOW','MEDIUM','HIGH','REFER')),
  status                   VARCHAR(20)      NOT NULL CONSTRAINT DF_merchants_status DEFAULT 'ONBOARDED',
  created_at               DATETIME2(3)     NOT NULL CONSTRAINT DF_merchants_created DEFAULT SYSUTCDATETIME(),
  updated_at               DATETIME2(3)     NOT NULL CONSTRAINT DF_merchants_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_merchants_licence UNIQUE (licence_no, licence_authority)
);
GO
CREATE INDEX IX_merchants_legal_name ON dbo.merchants (legal_name);
GO

CREATE TABLE dbo.merchant_parties (
  id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_merchant_parties PRIMARY KEY,
  merchant_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_parties_merchant REFERENCES dbo.merchants(id),
  role                VARCHAR(12)      NOT NULL CONSTRAINT CK_parties_role CHECK (role IN ('DIRECTOR','SIGNATORY','SHAREHOLDER','UBO')),
  full_name           NVARCHAR(300)    NOT NULL,
  nationality         NVARCHAR(100)    NULL,
  dob                 DATE             NULL,
  id_type             VARCHAR(30)      NULL,
  id_number_encrypted VARBINARY(512)   NULL,
  pii_key_id          VARCHAR(40)      NULL,
  id_expiry           DATE             NULL,
  ownership_pct       DECIMAL(7,4)     NULL CONSTRAINT CK_parties_pct CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100)),
  is_pep              BIT              NOT NULL CONSTRAINT DF_parties_pep DEFAULT 0,
  screening_status    VARCHAR(20)      NULL,
  created_at          DATETIME2(3)     NOT NULL CONSTRAINT DF_parties_created DEFAULT SYSUTCDATETIME(),
  updated_at          DATETIME2(3)     NOT NULL CONSTRAINT DF_parties_updated DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_parties_merchant ON dbo.merchant_parties (merchant_id, role);
GO

CREATE TABLE dbo.merchant_documents (
  id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_merchant_documents PRIMARY KEY,
  merchant_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_docs_merchant REFERENCES dbo.merchants(id),
  doc_type        VARCHAR(40)      NOT NULL,
  file_name       NVARCHAR(260)    NOT NULL,
  storage_key     NVARCHAR(400)    NOT NULL,
  sha256          CHAR(64)         NOT NULL,
  issued_on       DATE             NULL,
  expires_on      DATE             NULL,
  verified_status VARCHAR(20)      NOT NULL CONSTRAINT DF_docs_verified DEFAULT 'UNVERIFIED',
  created_at      DATETIME2(3)     NOT NULL CONSTRAINT DF_docs_created DEFAULT SYSUTCDATETIME(),
  updated_at      DATETIME2(3)     NOT NULL CONSTRAINT DF_docs_updated DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_docs_merchant ON dbo.merchant_documents (merchant_id, doc_type);
GO

CREATE TABLE dbo.onboarding_cases (
  id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_onboarding_cases PRIMARY KEY,
  merchant_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_cases_merchant REFERENCES dbo.merchants(id),
  mongo_case_id   VARCHAR(40)      NOT NULL,
  acquirer_code   VARCHAR(60)      NOT NULL,
  status          VARCHAR(20)      NOT NULL,
  risk_rating     VARCHAR(10)      NULL,
  decision        VARCHAR(12)      NULL,
  decided_by      NVARCHAR(400)    NULL,
  decided_at      DATETIME2(3)     NULL,
  model_version   VARCHAR(80)      NULL,
  prompt_version  VARCHAR(80)      NULL,
  created_at      DATETIME2(3)     NOT NULL CONSTRAINT DF_cases_created DEFAULT SYSUTCDATETIME(),
  updated_at      DATETIME2(3)     NOT NULL CONSTRAINT DF_cases_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_cases_mongo UNIQUE (mongo_case_id)
);
GO
CREATE INDEX IX_cases_merchant ON dbo.onboarding_cases (merchant_id);
GO

CREATE TABLE dbo.onboarding_tokens (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_onboarding_tokens PRIMARY KEY,
  case_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_tokens_case REFERENCES dbo.onboarding_cases(id),
  merchant_id  UNIQUEIDENTIFIER NOT NULL,
  token_hash   CHAR(64)         NOT NULL,
  scopes       VARCHAR(100)     NOT NULL,
  expires_at   DATETIME2(3)     NOT NULL,
  redeemed_at  DATETIME2(3)     NULL,
  revoked_at   DATETIME2(3)     NULL,
  created_by   NVARCHAR(200)    NOT NULL,
  created_at   DATETIME2(3)     NOT NULL CONSTRAINT DF_tokens_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_tokens_hash UNIQUE (token_hash)
);
GO
CREATE INDEX IX_tokens_case ON dbo.onboarding_tokens (case_id);
GO

CREATE TABLE dbo.screening_results (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_screening_results PRIMARY KEY,
  case_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_screening_case REFERENCES dbo.onboarding_cases(id),
  party_id    UNIQUEIDENTIFIER NULL,
  subject     NVARCHAR(300)    NOT NULL,
  provider    VARCHAR(60)      NOT NULL,
  is_mock     BIT              NOT NULL,
  result      VARCHAR(20)      NOT NULL,
  category    VARCHAR(20)      NULL,
  raw_ref     NVARCHAR(400)    NULL,
  created_at  DATETIME2(3)     NOT NULL CONSTRAINT DF_screening_created DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_screening_case ON dbo.screening_results (case_id);
GO

CREATE TABLE dbo.audit_log (
  id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_log PRIMARY KEY,
  actor        NVARCHAR(200)  NOT NULL,
  action       VARCHAR(80)    NOT NULL,
  entity       NVARCHAR(200)  NOT NULL,
  before_hash  CHAR(64)       NULL,
  after_hash   CHAR(64)       NULL,
  ip           VARCHAR(64)    NULL,
  at           DATETIME2(3)   NOT NULL CONSTRAINT DF_audit_at DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_audit_entity ON dbo.audit_log (entity, at);
GO

-- audit_log is append-only: block UPDATE and DELETE.
CREATE TRIGGER dbo.TR_audit_log_append_only ON dbo.audit_log
INSTEAD OF UPDATE, DELETE AS
BEGIN
  RAISERROR('audit_log is append-only', 16, 1);
  ROLLBACK TRANSACTION;
END;
GO
