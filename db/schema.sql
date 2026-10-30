CREATE SCHEMA IF NOT EXISTS business;
CREATE SCHEMA IF NOT EXISTS agent;
CREATE TABLE IF NOT EXISTS business.customers (
 id text PRIMARY KEY, name text NOT NULL, phone text NOT NULL, level text NOT NULL DEFAULT '普通会员', notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business.addresses (
 id text PRIMARY KEY, customer_id text NOT NULL REFERENCES business.customers(id), recipient text NOT NULL, phone text NOT NULL, address text NOT NULL, is_default boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS business.suppliers (
 id text PRIMARY KEY, name text NOT NULL, contact text NOT NULL, phone text NOT NULL, city text NOT NULL, lead_days integer NOT NULL CHECK(lead_days>0), notes text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS business.products (
 id text PRIMARY KEY, name text NOT NULL, category text NOT NULL, description text NOT NULL, material text NOT NULL, season text NOT NULL, image text NOT NULL, status text NOT NULL DEFAULT '上架' CHECK(status IN ('上架','下架')), price integer NOT NULL CHECK(price>0), supplier_id text NOT NULL REFERENCES business.suppliers(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business.skus (
 id text PRIMARY KEY, product_id text NOT NULL REFERENCES business.products(id), color text NOT NULL, size text NOT NULL, cost integer NOT NULL CHECK(cost>0), stock integer NOT NULL DEFAULT 0 CHECK(stock>=0), reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=stock), reorder_point integer NOT NULL DEFAULT 5 CHECK(reorder_point>=0), UNIQUE(product_id,color,size)
);
CREATE TABLE IF NOT EXISTS business.orders (
 id text PRIMARY KEY, customer_id text NOT NULL REFERENCES business.customers(id), status text NOT NULL CHECK(status IN ('待付款','待发货','已发货','已完成','已取消','已退款')), total integer NOT NULL CHECK(total>0), address jsonb NOT NULL, tracking text, carrier text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business.order_items (
 id bigserial PRIMARY KEY, order_id text NOT NULL REFERENCES business.orders(id), sku_id text NOT NULL REFERENCES business.skus(id), name text NOT NULL, color text NOT NULL, size text NOT NULL, price integer NOT NULL CHECK(price>0), quantity integer NOT NULL CHECK(quantity>0)
);
CREATE TABLE IF NOT EXISTS business.purchase_orders (
 id text PRIMARY KEY, supplier_id text NOT NULL REFERENCES business.suppliers(id), status text NOT NULL CHECK(status IN ('待到货','已入库')), total integer NOT NULL CHECK(total>0), paid boolean NOT NULL DEFAULT false, note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), received_at timestamptz
);
CREATE TABLE IF NOT EXISTS business.purchase_items (
 id bigserial PRIMARY KEY, purchase_id text NOT NULL REFERENCES business.purchase_orders(id), sku_id text NOT NULL REFERENCES business.skus(id), cost integer NOT NULL CHECK(cost>0), quantity integer NOT NULL CHECK(quantity>0)
);
CREATE TABLE IF NOT EXISTS business.aftersales (
 id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES business.orders(id), customer_id text NOT NULL REFERENCES business.customers(id), reason text NOT NULL, status text NOT NULL CHECK(status IN ('待审核','待退货','待退款','已退款','已拒绝')), amount integer NOT NULL CHECK(amount>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business.inventory_movements (
 id bigserial PRIMARY KEY, sku_id text NOT NULL REFERENCES business.skus(id), quantity integer NOT NULL, type text NOT NULL, reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business.ledger (
 id bigserial PRIMARY KEY, type text NOT NULL CHECK(type IN ('销售收款','采购付款','售后退款')), direction text NOT NULL CHECK(direction IN ('收入','支出')), amount integer NOT NULL CHECK(amount>0), reference text NOT NULL, counterparty text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(type,reference)
);
CREATE TABLE IF NOT EXISTS business.commands (
 id text PRIMARY KEY, actor_id text NOT NULL, capability text NOT NULL, request_digest text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_customer_date ON business.orders(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_sku ON business.inventory_movements(sku_id,created_at DESC);
CREATE TABLE IF NOT EXISTS agent.accounts (
 id text PRIMARY KEY, login text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL CHECK(role IN ('customer','admin')), customer_id text, password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS agent.sessions (
 token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES agent.accounts(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS agent.conversations (
 id uuid PRIMARY KEY, account_id text NOT NULL REFERENCES agent.accounts(id), title text NOT NULL DEFAULT '新的对话', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent.messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent.conversations(id), role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL, cards jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent.runs (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent.conversations(id), status text NOT NULL CHECK(status IN ('running','succeeded','failed')), prompt_version integer NOT NULL, model text NOT NULL, error_code text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON agent.runs(conversation_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS agent.tool_calls (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES agent.runs(id), capability text NOT NULL, label text NOT NULL, status text NOT NULL, arguments jsonb NOT NULL, result jsonb, duration_ms integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent.actions (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent.conversations(id), account_id text NOT NULL REFERENCES agent.accounts(id), capability text NOT NULL, arguments jsonb NOT NULL, preview jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','executing','completed','cancelled','failed')), result jsonb, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE TABLE IF NOT EXISTS agent.prompts (
 role text PRIMARY KEY CHECK(role IN ('customer','admin')), content text NOT NULL, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation ON agent.messages(conversation_id,created_at);
ALTER TABLE agent.actions DROP CONSTRAINT IF EXISTS actions_state_check;
ALTER TABLE agent.actions ADD CONSTRAINT actions_state_check CHECK(state IN ('pending','executing','completed','cancelled','failed'));
ALTER TABLE agent.messages ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES agent.runs(id);
CREATE TABLE IF NOT EXISTS agent.events (
 id bigserial PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES agent.conversations(id), run_id uuid REFERENCES agent.runs(id), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_conversation ON agent.events(conversation_id,id);
CREATE TABLE IF NOT EXISTS agent.conversation_memories (
 conversation_id uuid PRIMARY KEY REFERENCES agent.conversations(id) ON DELETE CASCADE,
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent.runs ADD COLUMN IF NOT EXISTS context_stats jsonb NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS messages_conversation_order ON agent.messages(conversation_id,created_at,id);
