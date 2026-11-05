import { randomUUID } from "node:crypto";
import type pg from "pg";
import { BusinessError, transaction } from "../../shared/db.ts";
import type { Identity } from "../../shared/security.ts";
import { findCapability, invoke } from "./business.ts";
import { config } from "../../shared/config.ts";

export interface DraftRevision {
  actionId: string;
  version: number;
}

export async function lockConversation(
  db: pg.PoolClient,
  conversationId: string,
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `conversation:${conversationId}`,
  ]);
}

export async function prepare(
  pool: pg.Pool,
  conversationId: string,
  identity: Identity,
  name: string,
  patch: Record<string, unknown>,
  revision?: DraftRevision,
) {
  const cap = await findCapability(name, identity);
  if (!cap.write)
    throw new BusinessError("READ_ONLY_CAPABILITY", "查询能力不需要确认");
  const id = randomUUID();
  let previous: any;
  if (revision) {
    previous = await transaction(pool, async (db) => {
      await lockConversation(db, conversationId);
      const row = (
        await db.query(
          "SELECT * FROM agent.actions WHERE id=$1 AND conversation_id=$2 AND account_id=$3 FOR UPDATE",
          [revision.actionId, conversationId, identity.id],
        )
      ).rows[0];
      if (!row) throw new BusinessError("NOT_FOUND", "待修改的草稿不存在", 404);
      if (config().workflows?.enabled) {
        const linked = await db.query("SELECT 1 FROM agent.workflows WHERE data->>'actionId'=$1 AND status NOT IN ('completed','cancelled','failed')", [row.id]);
        if (linked.rowCount) throw new BusinessError("WORKFLOW_REVIEW_REQUIRED", "此草稿绑定已审核建议。需要调整时，请先取消任务并重新提出需求");
      }
      if (row.capability !== name || row.revision !== revision.version)
        throw new BusinessError(
          "DRAFT_VERSION_CONFLICT",
          "草稿版本或操作不匹配，请查看当前草稿",
          409,
        );
      if (!["pending", "revision_failed"].includes(row.state))
        throw new BusinessError(
          "DRAFT_UNAVAILABLE",
          "该版本已提交、被替代或不可修改",
          409,
        );
      if (new Date(row.expires_at).getTime() <= Date.now())
        throw new BusinessError(
          "ACTION_EXPIRED",
          "草稿已过期，请取消后重新准备",
          409,
        );
      await db.query("UPDATE agent.actions SET state='revising' WHERE id=$1", [
        row.id,
      ]);
      return row;
    });
  }
  try {
    // A shallow patch preserves omitted fields. Arrays must be supplied in full.
    const args = previous ? { ...previous.arguments, ...patch } : patch;
    const preview = await invoke(name, args, identity, "preview");
    const version = previous ? previous.revision + 1 : 1;
    await transaction(pool, async (db) => {
      await lockConversation(db, conversationId);
      const owner = await db.query(
        "SELECT 1 FROM agent.conversations WHERE id=$1 AND account_id=$2",
        [conversationId, identity.id],
      );
      if (!owner.rowCount)
        throw new BusinessError("NOT_FOUND", "会话不存在", 404);
      if (previous) {
        const claimed = await db.query(
          "UPDATE agent.actions SET state='superseded' WHERE id=$1 AND state='revising' RETURNING id",
          [previous.id],
        );
        if (!claimed.rowCount)
          throw new BusinessError(
            "DRAFT_VERSION_CONFLICT",
            "草稿状态已变化，请重新查看",
            409,
          );
      } else {
        const active = await db.query(
          "SELECT 1 FROM agent.actions WHERE conversation_id=$1 AND capability=$2 AND state IN ('pending','executing','revising','revision_failed') LIMIT 1",
          [conversationId, name],
        );
        if (active.rowCount)
          throw new BusinessError(
            "DRAFT_TARGET_REQUIRED",
            "已有此操作的未完成草稿，请明确修改目标，或先取消旧草稿",
            409,
          );
      }
      await db.query(
        "INSERT INTO agent.actions(id,conversation_id,account_id,capability,arguments,preview,draft_id,revision,supersedes_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          conversationId,
          identity.id,
          name,
          JSON.stringify(args),
          JSON.stringify(preview),
          previous?.draft_id ?? id,
          version,
          previous?.id ?? null,
        ],
      );
      await db.query(
        "UPDATE agent.conversations SET title=CASE WHEN title='新的对话' THEN $1 ELSE title END,updated_at=now() WHERE id=$2",
        [cap.label, conversationId],
      );
    });
    return {
      id,
      capability: name,
      label: cap.label,
      preview,
      revision: version,
      supersedesId: previous?.id ?? null,
    };
  } catch (error) {
    if (previous)
      await pool.query(
        "UPDATE agent.actions SET state='revision_failed' WHERE id=$1 AND state='revising'",
        [previous.id],
      );
    throw error;
  }
}
