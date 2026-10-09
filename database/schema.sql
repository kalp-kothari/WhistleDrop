-- WhistleDrop Database Schema
-- Re-runnable: all statements use IF NOT EXISTS
-- Run: psql $DATABASE_URL -f database/schema.sql

CREATE TABLE IF NOT EXISTS reports (
    id          SERIAL PRIMARY KEY,
    case_code_hash VARCHAR(64) NOT NULL,
    category    VARCHAR(32)  NOT NULL,
    description TEXT         NOT NULL,
    evidence_url VARCHAR(2048),
    status      VARCHAR(32)  NOT NULL DEFAULT 'SUBMITTED',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT reports_case_code_hash_unique UNIQUE (case_code_hash),

    CONSTRAINT reports_category_check CHECK (
        category IN ('Security', 'Harassment', 'Corruption', 'Technical', 'Other')
    ),
    CONSTRAINT reports_status_check CHECK (
        status IN ('SUBMITTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED')
    ),
    CONSTRAINT reports_description_length CHECK (
        char_length(description) >= 10 AND char_length(description) <= 5000
    )
);

CREATE TABLE IF NOT EXISTS moderators (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(64)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT moderators_username_unique UNIQUE (username)
);

CREATE TABLE IF NOT EXISTS report_updates (
    id          SERIAL PRIMARY KEY,
    report_id   INTEGER      NOT NULL,
    moderator_id INTEGER     NOT NULL,
    message     TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT report_updates_report_fk
        FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE RESTRICT,
    CONSTRAINT report_updates_moderator_fk
        FOREIGN KEY (moderator_id) REFERENCES moderators(id) ON DELETE RESTRICT,
    CONSTRAINT report_updates_message_length CHECK (
        char_length(message) >= 1 AND char_length(message) <= 1000
    )
);

-- Indexes for performant filtering and ordering
CREATE INDEX IF NOT EXISTS idx_reports_status     ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_category   ON reports(category);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_report_updates_report_id ON report_updates(report_id);
