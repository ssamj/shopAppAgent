CREATE TABLE IF NOT EXISTS business.replenishment_rules (
 id text PRIMARY KEY, title text NOT NULL, version text NOT NULL, content_hash text NOT NULL,
 embedding_model text NOT NULL, dimensions integer NOT NULL, rule jsonb NOT NULL, sections jsonb NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business.replenishment_snapshots (
 id text PRIMARY KEY, actor_id text NOT NULL, rule_id text NOT NULL REFERENCES business.replenishment_rules(id),
 rule_hash text NOT NULL, snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
 assessment jsonb, state text NOT NULL CHECK(state IN ('captured','calculated','verified','issued')),
 created_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS replenishment_snapshots_actor ON business.replenishment_snapshots(actor_id,created_at DESC);
