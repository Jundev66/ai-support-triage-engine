-- Initialize schema and extensions
CREATE SCHEMA IF NOT EXISTS n8n_system;
CREATE SCHEMA IF NOT EXISTS app_triage;

-- Enable pgvector extension for AI semantic search
CREATE EXTENSION IF NOT EXISTS vector;

SET search_path TO app_triage, public;

-- 1. Support Tickets Table (with Idempotency guarantee)
CREATE TABLE IF NOT EXISTS app_triage.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    customer_id VARCHAR(64) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'unclassified',
    urgency VARCHAR(32) NOT NULL DEFAULT 'normal', -- low, normal, high, critical
    sentiment VARCHAR(32) NOT NULL DEFAULT 'neutral', -- positive, neutral, negative, urgent
    assigned_tier VARCHAR(32) NOT NULL DEFAULT 'tier_1_bot', -- tier_1_bot, tier_2_human, security_escalation
    resolution_status VARCHAR(32) NOT NULL DEFAULT 'open', -- open, pending_human, resolved, closed
    automated_response TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for status and priority lookups
CREATE INDEX IF NOT EXISTS idx_tickets_status ON app_triage.tickets(resolution_status);
CREATE INDEX IF NOT EXISTS idx_tickets_urgency ON app_triage.tickets(urgency);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON app_triage.tickets(created_at DESC);

-- 2. Knowledge Base with Vector Embeddings (1536 dimensions for text-embedding-3-small / ada-002)
CREATE TABLE IF NOT EXISTS app_triage.knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW Vector Index for sub-millisecond semantic search
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_hnsw 
ON app_triage.knowledge_base 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. Dead Letter Queue (DLQ) for Resilience & Observability
CREATE TABLE IF NOT EXISTS app_triage.dead_letter_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id VARCHAR(128) NOT NULL,
    execution_id VARCHAR(128) NOT NULL,
    error_message TEXT NOT NULL,
    error_node VARCHAR(128),
    error_stack TEXT,
    failed_payload JSONB NOT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_resolved ON app_triage.dead_letter_queue(resolved);
CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON app_triage.dead_letter_queue(created_at DESC);

-- Helper function to generate deterministic test embeddings (1536 dim) for dev/testing environments without external API keys
CREATE OR REPLACE FUNCTION app_triage.generate_test_embedding(seed_val int)
RETURNS vector(1536) AS $$
DECLARE
    vec_text text;
BEGIN
    SELECT '[' || string_agg(CASE WHEN (i = (seed_val % 1536 + 1)) THEN '1.0' ELSE '0.0' END, ',') || ']'
    INTO vec_text
    FROM generate_series(1, 1536) AS i;
    RETURN vec_text::vector;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper function to match knowledge documents by vector cosine similarity
CREATE OR REPLACE FUNCTION app_triage.match_knowledge_base (
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.75,
    match_count int DEFAULT 3
)
RETURNS TABLE (
    id UUID,
    title VARCHAR(255),
    content TEXT,
    similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        id,
        title,
        content,
        1 - (knowledge_base.embedding <=> query_embedding) AS similarity
    FROM app_triage.knowledge_base
    WHERE 1 - (knowledge_base.embedding <=> query_embedding) > match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
$$;
