ALTER TABLE agent.actions ADD COLUMN IF NOT EXISTS draft_id uuid;
UPDATE agent.actions SET draft_id=id WHERE draft_id IS NULL;
ALTER TABLE agent.actions ALTER COLUMN draft_id SET NOT NULL;
ALTER TABLE agent.actions ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE agent.actions ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES agent.actions(id);
CREATE UNIQUE INDEX IF NOT EXISTS action_draft_revision ON agent.actions(draft_id,revision);
CREATE UNIQUE INDEX IF NOT EXISTS action_one_successor ON agent.actions(supersedes_id) WHERE supersedes_id IS NOT NULL;
ALTER TABLE agent.actions DROP CONSTRAINT IF EXISTS actions_state_check;
ALTER TABLE agent.actions ADD CONSTRAINT actions_state_check CHECK(state IN ('pending','executing','completed','cancelled','failed','revising','revision_failed','superseded'));
