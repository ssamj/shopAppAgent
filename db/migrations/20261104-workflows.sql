CREATE TABLE IF NOT EXISTS agent.workflows (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent.conversations(id),
 account_id text NOT NULL REFERENCES agent.accounts(id), name text NOT NULL,
 goal text NOT NULL, node text NOT NULL, status text NOT NULL
 CHECK(status IN ('ready','running','waiting_review','waiting_confirmation','completed','cancelled','failed')),
 version integer NOT NULL DEFAULT 1, data jsonb NOT NULL DEFAULT '{}',
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_one_active ON agent.workflows(conversation_id)
 WHERE status NOT IN ('completed','cancelled','failed');
CREATE TABLE IF NOT EXISTS agent.workflow_jobs (
 id uuid PRIMARY KEY, workflow_id uuid NOT NULL REFERENCES agent.workflows(id),
 version integer NOT NULL, node text NOT NULL, status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','running','completed','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(workflow_id,version)
);
CREATE TABLE IF NOT EXISTS agent.workflow_events (
 id bigserial PRIMARY KEY, workflow_id uuid NOT NULL REFERENCES agent.workflows(id),
 version integer NOT NULL, kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
 dedupe_key text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workflow_id,dedupe_key)
);
CREATE TABLE IF NOT EXISTS agent.workflow_runs (
 run_id uuid PRIMARY KEY REFERENCES agent.runs(id), workflow_id uuid NOT NULL REFERENCES agent.workflows(id),
 node text NOT NULL, decisions jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS workflow_jobs_pending ON agent.workflow_jobs(created_at) WHERE status='pending';
