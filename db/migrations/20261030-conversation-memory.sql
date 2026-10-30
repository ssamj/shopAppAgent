CREATE TABLE IF NOT EXISTS agent.conversation_memories (
 conversation_id uuid PRIMARY KEY REFERENCES agent.conversations(id) ON DELETE CASCADE,
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent.runs ADD COLUMN IF NOT EXISTS context_stats jsonb NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS messages_conversation_order ON agent.messages(conversation_id,created_at,id);
