ALTER TABLE agent.workflows ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'self'
 CHECK (engine IN ('self','langgraph'));
CREATE SCHEMA IF NOT EXISTS agent_graph;
