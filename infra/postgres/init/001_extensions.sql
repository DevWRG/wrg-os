-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- fuzzy match #REPORT → deal (similarity())
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector untuk RAG Walk+

-- Langfuse DB (terpisah dari wrg_os)
CREATE DATABASE langfuse;
