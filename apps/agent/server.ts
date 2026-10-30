import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { database, transaction, BusinessError } from "../../shared/db.ts";
import { config } from "../../shared/config.ts";
import {
  verifyPassword,
  token,
  digest,
  fingerprint,
  type Identity,
} from "../../shared/security.ts";
import { definitions, findCapability, invoke } from "./business.ts";
import { prepare, run } from "./runtime.ts";
import { loadMemory, loadReferences } from "./memory.ts";
import { progress, subscribe, storedEvent } from "./events.ts";
import type { ProgressEvent } from "../../shared/events.ts";
import type { ServerResponse } from "node:http";
const pool = database("agent");
const app = Fastify({
  logger: false,
  bodyLimit: 131072,
  ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
});
await app.register(cookie);
const interrupted = await pool.query(
  "UPDATE agent.runs SET status='failed',error_code='SERVICE_RESTARTED',finished_at=now() WHERE status='running' RETURNING id,conversation_id",
);
for (const row of interrupted.rows) {
  await pool.query(
    "INSERT INTO agent.messages(id,conversation_id,role,content) VALUES($1,$2,'assistant',$3)",
    [
      randomUUID(),
      row.conversation_id,
      "服务重新启动，上一条请求未完成。请重新发送需要处理的业务。",
    ],
  );
  await progress(pool, {
    conversationId: row.conversation_id,
    runId: row.id,
    type: "run-failed",
    title: "服务重启，本次处理已中断",
    detail: "已保存此前的执行记录，请重新发送需求。",
  });
}
await pool.query(
  "UPDATE agent.tool_calls SET status='failed' WHERE status='running'",
);
await pool.query(
  "UPDATE agent.actions SET state='pending' WHERE state='executing'",
);
const identities = new WeakMap<object, Identity>();
const loginAttempts = new Map<string, { count: number; until: number }>();
const channel = (req: any) =>
  req.headers["x-client"] === "shop" ? "shop" : "admin";
const cookieName = (req: any) => `qihe_${channel(req)}`;
app.addHook("onRequest", async (req, reply) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (!["127.0.0.1", "localhost"].includes(origin.hostname))
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: "请求来源无效" });
    } catch {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "请求来源无效" });
    }
  }
  if (req.url === "/api/health" || req.url === "/api/auth/login") return;
  const raw = req.cookies[cookieName(req)];
  if (!raw)
    return reply
      .code(401)
      .send({ code: "LOGIN_REQUIRED", message: "请先登录" });
  const row = (
    await pool.query(
      'SELECT a.id,a.name,a.role,a.customer_id AS "customerId" FROM agent.sessions s JOIN agent.accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [digest(raw)],
    )
  ).rows[0];
  if (!row || row.role !== (channel(req) === "shop" ? "customer" : "admin"))
    return reply
      .code(401)
      .send({ code: "LOGIN_REQUIRED", message: "请先登录当前入口" });
  identities.set(req, row);
});
app.setErrorHandler((error, req, reply) => {
  if (error instanceof BusinessError)
    return reply
      .code(error.status)
      .send({ code: error.code, message: error.message });
  if ((error as any).validation)
    return reply
      .code(400)
      .send({ code: "INVALID_ARGUMENTS", message: "请检查填写的信息" });
  if ((error as any).code === "23505")
    return reply
      .code(409)
      .send({ code: "RUN_BUSY", message: "当前对话正在处理中，请稍候" });
  console.error(
    JSON.stringify({
      event: "agent_error",
      requestId: req.id,
      code: (error as any).code || "INTERNAL_ERROR",
    }),
  );
  reply
    .code(500)
    .send({ code: "INTERNAL_ERROR", message: "服务暂时无法完成请求" });
});
const who = (req: object) => identities.get(req)!;
async function owns(id: string, identity: Identity) {
  const row = (
    await pool.query(
      "SELECT * FROM agent.conversations WHERE id=$1 AND account_id=$2",
      [id, identity.id],
    )
  ).rows[0];
  if (!row) throw new BusinessError("NOT_FOUND", "对话不存在", 404);
  return row;
}
const idSchema = Type.String({ format: "uuid" });
const object = (fields: any) =>
  Type.Object(fields, { additionalProperties: false });
app.get("/api/health", async () => {
  await pool.query("SELECT 1");
  return { status: "ok", service: "agent", model: config().model.model };
});
app.post<{ Body: { login: string; password: string } }>(
  "/api/auth/login",
  {
    schema: {
      body: object({
        login: Type.String({ minLength: 1, maxLength: 60 }),
        password: Type.String({ minLength: 1, maxLength: 200 }),
      }),
    },
  },
  async (req, reply) => {
    const key = `${req.ip}:${req.body.login}`;
    const previous = loginAttempts.get(key);
    if (previous && previous.until > Date.now() && previous.count >= 8)
      throw new BusinessError(
        "RATE_LIMITED",
        "登录尝试过多，请一分钟后再试",
        429,
      );
    const user = (
      await pool.query("SELECT * FROM agent.accounts WHERE login=$1", [
        req.body.login,
      ])
    ).rows[0];
    if (
      !user ||
      !verifyPassword(req.body.password, user.password_hash) ||
      user.role !== (channel(req) === "shop" ? "customer" : "admin")
    ) {
      loginAttempts.set(key, {
        count: previous && previous.until > Date.now() ? previous.count + 1 : 1,
        until: Date.now() + 60000,
      });
      throw new BusinessError("INVALID_LOGIN", "账号或密码不正确", 401);
    }
    loginAttempts.delete(key);
    const raw = token();
    await pool.query(
      "INSERT INTO agent.sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [digest(raw), user.id],
    );
    reply.setCookie(cookieName(req), raw, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 604800,
    });
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      customerId: user.customer_id,
    };
  },
);
app.get("/api/auth/me", async (req) => who(req));
app.post("/api/auth/logout", async (req, reply) => {
  await pool.query("DELETE FROM agent.sessions WHERE token_hash=$1", [
    digest(req.cookies[cookieName(req)] || ""),
  ]);
  reply.clearCookie(cookieName(req), { path: "/" });
  for (const [stream, session] of eventStreams)
    if (session === digest(req.cookies[cookieName(req)] || "")) stream.end();
  return { success: true };
});
app.get(
  "/api/conversations",
  async (req) =>
    (
      await pool.query(
        "SELECT id,title,created_at,updated_at FROM agent.conversations WHERE account_id=$1 ORDER BY updated_at DESC LIMIT 40",
        [who(req).id],
      )
    ).rows,
);
app.post("/api/conversations", async (req) => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO agent.conversations(id,account_id) VALUES($1,$2)",
    [id, who(req).id],
  );
  return { id, title: "新的对话" };
});
app.get<{ Params: { id: string } }>(
  "/api/conversations/:id/memory",
  { schema: { params: object({ id: idSchema }) } },
  async (req) => {
    const identity = who(req);
    await owns(req.params.id, identity);
    const memory = await loadMemory(pool, req.params.id, identity.id);
    return {
      ...memory,
      references: await loadReferences(
        pool,
        req.params.id,
        identity.id,
        memory.resetMessageId,
      ),
    };
  },
);
app.get<{ Params: { id: string } }>(
  "/api/conversations/:id",
  { schema: { params: object({ id: idSchema }) } },
  async (req) => {
    await owns(req.params.id, who(req));
    const [messages, actions, runs, calls, events] = await Promise.all([
      pool.query(
        "SELECT id,role,content,cards,run_id,created_at FROM agent.messages WHERE conversation_id=$1 ORDER BY created_at,id",
        [req.params.id],
      ),
      pool.query(
        "SELECT id,capability,preview,state,result,created_at,expires_at FROM agent.actions WHERE conversation_id=$1 ORDER BY created_at",
        [req.params.id],
      ),
      pool.query(
        "SELECT id,status,model,prompt_version,error_code,context_stats,created_at FROM agent.runs WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 8",
        [req.params.id],
      ),
      pool.query(
        "SELECT t.id,t.run_id,t.label,t.status,t.duration_ms,t.created_at FROM agent.tool_calls t JOIN agent.runs r ON r.id=t.run_id WHERE r.conversation_id=$1 ORDER BY t.created_at DESC LIMIT 30",
        [req.params.id],
      ),
      pool.query(
        "SELECT id::text,payload,created_at FROM agent.events WHERE conversation_id=$1 ORDER BY agent.events.id",
        [req.params.id],
      ),
    ]);
    return {
      messages: messages.rows,
      actions: actions.rows,
      runs: runs.rows,
      calls: calls.rows,
      events: events.rows.map(storedEvent),
    };
  },
);
const eventStreams = new Map<ServerResponse, string>();
app.addHook("preClose", async () => {
  for (const stream of eventStreams.keys()) stream.end();
});
app.post<{ Params: { id: string }; Body: { afterId?: string } }>(
  "/api/conversations/:id/events/stream",
  {
    schema: {
      params: object({ id: idSchema }),
      body: object({
        afterId: Type.Optional(Type.String({ pattern: "^[0-9]{1,18}$" })),
      }),
    },
  },
  async (req, reply) => {
    await owns(req.params.id, who(req));
    const conversationId = req.params.id;
    let cursor = BigInt(req.body.afterId || "0"),
      replaying = true,
      closed = false;
    const buffered: ProgressEvent[] = [];
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.flushHeaders();
    const session = digest(req.cookies[cookieName(req)] || "");
    eventStreams.set(raw, session);
    const write = (event: ProgressEvent) => {
      if (closed || BigInt(event.id) <= cursor) return;
      if (
        !raw.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        ) &&
        raw.writableLength > 262144
      ) {
        raw.destroy();
        return;
      }
      cursor = BigInt(event.id);
    };
    const unsubscribe = subscribe(conversationId, (event) => {
      if (closed) return;
      if (replaying) {
        buffered.push(event);
        if (buffered.length > 1000) raw.destroy();
      } else write(event);
    });
    const heartbeat = setInterval(() => {
      void pool
        .query(
          "SELECT 1 FROM agent.sessions WHERE token_hash=$1 AND expires_at>now()",
          [session],
        )
        .then((result) => {
          if (closed) return;
          if (!result.rowCount) {
            raw.end();
            return;
          }
          raw.write(": heartbeat\n\n");
        })
        .catch(() => raw.end());
    }, 15000);
    raw.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      eventStreams.delete(raw);
    });
    try {
      while (!closed) {
        const rows = (
          await pool.query(
            "SELECT id::text,payload,created_at FROM agent.events WHERE conversation_id=$1 AND id>$2 ORDER BY agent.events.id LIMIT 200",
            [conversationId, cursor.toString()],
          )
        ).rows;
        for (const row of rows) write(storedEvent(row));
        if (rows.length < 200) break;
      }
      for (const event of buffered) write(event);
      replaying = false;
      if (!closed)
        raw.write(
          `event: stream-ready\ndata: ${JSON.stringify({ type: "stream-ready", conversationId })}\n\n`,
        );
    } catch {
      raw.end();
    }
  },
);
async function publishAction(
  action: any,
  type:
    | "action-started"
    | "action-completed"
    | "action-failed"
    | "action-cancelled",
  title: string,
  detail: string,
) {
  const linked = (
    await pool.query(
      "SELECT run_id FROM agent.events WHERE conversation_id=$1 AND payload->>'actionId'=$2 ORDER BY id DESC LIMIT 1",
      [action.conversation_id, action.id],
    )
  ).rows[0];
  await progress(pool, {
    conversationId: action.conversation_id,
    runId: linked?.run_id || null,
    actionId: action.id,
    type,
    title,
    detail,
  });
}
app.post<{ Params: { id: string }; Body: { message: string } }>(
  "/api/conversations/:id/messages",
  {
    schema: {
      params: object({ id: idSchema }),
      body: object({ message: Type.String({ minLength: 1, maxLength: 3000 }) }),
    },
  },
  async (req, reply) => {
    const identity = who(req),
      conversation = await owns(req.params.id, identity);
    const prompt = (
      await pool.query(
        "SELECT content,version FROM agent.prompts WHERE role=$1",
        [identity.role],
      )
    ).rows[0];
    const runId = randomUUID();
    await transaction(pool, async (db) => {
      await db.query(
        "INSERT INTO agent.runs(id,conversation_id,status,prompt_version,model) VALUES($1,$2,'running',$3,$4)",
        [runId, conversation.id, prompt.version, config().model.model],
      );
      await db.query(
        "INSERT INTO agent.messages(id,conversation_id,role,content,run_id) VALUES($1,$2,'user',$3,$4)",
        [randomUUID(), conversation.id, req.body.message, runId],
      );
      await db.query(
        "UPDATE agent.conversations SET title=CASE WHEN title='新的对话' THEN $1 ELSE title END,updated_at=now() WHERE id=$2",
        [req.body.message.slice(0, 28), conversation.id],
      );
    });
    void run(pool, runId, conversation.id, identity, prompt).catch(() =>
      console.error(JSON.stringify({ event: "run_persistence_failed", runId })),
    );
    return reply.code(202).send({ runId });
  },
);
app.post<{
  Body: {
    capability: string;
    arguments: Record<string, unknown>;
    conversationId?: string;
  };
}>(
  "/api/business/query",
  {
    schema: {
      body: object({
        capability: Type.String({ maxLength: 80 }),
        arguments: Type.Record(Type.String(), Type.Unknown()),
        conversationId: Type.Optional(idSchema),
      }),
    },
  },
  async (req) => {
    const identity = who(req);
    const cap = await findCapability(req.body.capability, identity);
    if (cap.write)
      throw new BusinessError("CONFIRMATION_REQUIRED", "业务变更需要确认");
    if (req.body.conversationId) await owns(req.body.conversationId, identity);
    const result = await invoke(cap.name, req.body.arguments, identity, "read");
    if (req.body.conversationId) {
      await pool.query(
        "INSERT INTO agent.messages(id,conversation_id,role,content,cards) VALUES($1,$2,'assistant',$3,$4)",
        [
          randomUUID(),
          req.body.conversationId,
          cap.label,
          JSON.stringify([{ ...result, capability: cap.name }]),
        ],
      );
      await pool.query(
        "UPDATE agent.conversations SET title=CASE WHEN title='新的对话' THEN $1 ELSE title END,updated_at=now() WHERE id=$2",
        [cap.label, req.body.conversationId],
      );
    }
    return result;
  },
);
app.post<{
  Body: {
    capability: string;
    arguments: Record<string, unknown>;
    conversationId: string;
  };
}>(
  "/api/actions/prepare",
  {
    schema: {
      body: object({
        capability: Type.String({ maxLength: 80 }),
        arguments: Type.Record(Type.String(), Type.Unknown()),
        conversationId: idSchema,
      }),
    },
  },
  async (req) => {
    const identity = who(req);
    await owns(req.body.conversationId, identity);
    return prepare(
      pool,
      req.body.conversationId,
      identity,
      req.body.capability,
      req.body.arguments,
    );
  },
);
app.post<{ Params: { id: string } }>(
  "/api/actions/:id/confirm",
  { schema: { params: object({ id: idSchema }) } },
  async (req) => {
    const identity = who(req);
    const action = (
      await pool.query(
        "SELECT * FROM agent.actions WHERE id=$1 AND account_id=$2",
        [req.params.id, identity.id],
      )
    ).rows[0];
    if (!action) throw new BusinessError("NOT_FOUND", "操作不存在", 404);
    if (action.state === "completed") return action.result;
    if (action.state !== "pending")
      throw new BusinessError(
        "ACTION_UNAVAILABLE",
        "操作已取消、正在提交或已失效",
        409,
      );
    if (new Date(action.expires_at).getTime() < Date.now()) {
      await pool.query(
        "UPDATE agent.actions SET state='failed' WHERE id=$1 AND state='pending'",
        [action.id],
      );
      throw new BusinessError(
        "ACTION_EXPIRED",
        "确认卡已过期，请重新准备",
        409,
      );
    }
    const claim = await pool.query(
      "UPDATE agent.actions SET state='executing' WHERE id=$1 AND state='pending' RETURNING id",
      [action.id],
    );
    if (!claim.rowCount)
      throw new BusinessError("ACTION_BUSY", "操作正在提交，请稍候", 409);
    try {
      await publishAction(
        action,
        "action-started",
        "已确认，正在办理",
        "正在重新核对业务状态并提交本次操作。",
      );
      const result = await invoke(
        action.capability,
        action.arguments,
        identity,
        "commit",
        action.id,
        fingerprint(action.preview),
      );
      await transaction(pool, async (db) => {
        await db.query(
          "UPDATE agent.actions SET state='completed',result=$1 WHERE id=$2",
          [JSON.stringify(result), action.id],
        );
        await db.query(
          "INSERT INTO agent.messages(id,conversation_id,role,content,cards) VALUES($1,$2,'assistant',$3,$4)",
          [
            randomUUID(),
            action.conversation_id,
            "操作已完成。",
            JSON.stringify([{ ...result, capability: action.capability }]),
          ],
        );
      });
      await publishAction(
        action,
        "action-completed",
        "业务操作已完成",
        `「${result.title}」已更新，可查看办理结果。`,
      ).catch(() =>
        console.error(
          JSON.stringify({
            event: "action_progress_persistence_failed",
            actionId: action.id,
          }),
        ),
      );
      return result;
    } catch (e) {
      const error = e as BusinessError;
      await pool.query("UPDATE agent.actions SET state=$1 WHERE id=$2", [
        error.status >= 500 || !(error instanceof BusinessError)
          ? "pending"
          : "failed",
        action.id,
      ]);
      await publishAction(
        action,
        "action-failed",
        "本次办理未完成",
        error instanceof BusinessError
          ? error.message
          : "提交中断，请查询状态后重试。",
      );
      throw e;
    }
  },
);
app.post<{ Params: { id: string } }>(
  "/api/actions/:id/cancel",
  { schema: { params: object({ id: idSchema }) } },
  async (req) => {
    const r = await pool.query(
      "UPDATE agent.actions SET state='cancelled' WHERE id=$1 AND account_id=$2 AND state='pending' RETURNING id,conversation_id",
      [req.params.id, who(req).id],
    );
    if (!r.rowCount)
      throw new BusinessError(
        "ACTION_UNAVAILABLE",
        "操作已提交或无法取消",
        409,
      );
    await publishAction(
      r.rows[0],
      "action-cancelled",
      "已取消本次操作",
      "确认卡已取消，未更新业务记录。",
    );
    return { success: true };
  },
);
app.get("/api/settings", async (req) => {
  if (who(req).role !== "admin")
    throw new BusinessError("FORBIDDEN", "无管理权限", 403);
  return {
    model: config().model.model,
    prompts: (
      await pool.query(
        "SELECT role,content,version,updated_at FROM agent.prompts ORDER BY role",
      )
    ).rows,
    capabilities: (await definitions()).map(
      ({ name, module, label, description, write, roles, input }) => ({
        name,
        module,
        label,
        description,
        write,
        roles,
        input,
      }),
    ),
  };
});
app.put<{ Body: { role: string; content: string; version: number } }>(
  "/api/settings/prompt",
  {
    schema: {
      body: object({
        role: Type.Union([Type.Literal("customer"), Type.Literal("admin")]),
        content: Type.String({ minLength: 30, maxLength: 12000 }),
        version: Type.Integer({ minimum: 1 }),
      }),
    },
  },
  async (req) => {
    if (who(req).role !== "admin")
      throw new BusinessError("FORBIDDEN", "无管理权限", 403);
    const r = await pool.query(
      "UPDATE agent.prompts SET content=$1,version=version+1,updated_at=now() WHERE role=$2 AND version=$3 RETURNING role,version",
      [req.body.content, req.body.role, req.body.version],
    );
    if (!r.rowCount)
      throw new BusinessError(
        "VERSION_CONFLICT",
        "编排内容已更新，请重新打开后编辑",
        409,
      );
    return r.rows[0];
  },
);
const address = await app.listen({ host: "127.0.0.1", port: 3180 });
console.log(`Agent ready: ${address}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
