CREATE TABLE IF NOT EXISTS business.knowledge_indexes (
 id text PRIMARY KEY, embedding_model text NOT NULL, dimensions integer NOT NULL CHECK(dimensions>0),
 corpus_hash text NOT NULL, active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_one_active ON business.knowledge_indexes(active) WHERE active;
CREATE TABLE IF NOT EXISTS business.knowledge_documents (
 index_id text NOT NULL REFERENCES business.knowledge_indexes(id), id text NOT NULL,
 title text NOT NULL, version text NOT NULL, product_ids text[] NOT NULL,
 scope text NOT NULL CHECK(scope IN ('product','general')), audience text NOT NULL CHECK(audience IN ('public','admin')),
 origin text NOT NULL CHECK(origin='teaching'), content_hash text NOT NULL,
 PRIMARY KEY(index_id,id)
);
CREATE TABLE IF NOT EXISTS business.knowledge_chunks (
 index_id text NOT NULL, document_id text NOT NULL, id text NOT NULL,
 section text NOT NULL, content text NOT NULL, content_hash text NOT NULL, embedding double precision[] NOT NULL,
 PRIMARY KEY(index_id,id), FOREIGN KEY(index_id,document_id) REFERENCES business.knowledge_documents(index_id,id)
);
ALTER TABLE agent.messages ADD COLUMN IF NOT EXISTS answer jsonb;
