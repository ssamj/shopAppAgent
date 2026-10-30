import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { database, transaction, BusinessError } from "../../shared/db.ts";
import { config } from "../../shared/config.ts";
import { digest, fingerprint } from "../../shared/security.ts";
import { capabilities } from "./capabilities.ts";
import { resultSchema } from "./contracts.ts";
export const pool = database("business");
export const app = Fastify({
  logger: false,
  bodyLimit: 131072,
  ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
});
await app.register(swagger, {
  openapi: {
    info: { title: "栖禾电商业务 API", version: "1.0.0" },
    servers: [{ url: "http://127.0.0.1:3181" }],
  },
});
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  if (req.headers["x-service-key"] !== config().internalSecret)
    return reply
      .code(401)
      .send({ code: "UNAUTHORIZED", message: "服务身份验证失败" });
});
app.setErrorHandler((error, req, reply) => {
  if (error instanceof BusinessError)
    return reply
      .code(error.status)
      .send({ code: error.code, message: error.message });
  if ((error as any).validation)
    return reply
      .code(400)
      .send({ code: "INVALID_ARGUMENTS", message: "参数格式不符合接口要求" });
  console.error(
    JSON.stringify({
      event: "business_error",
      requestId: req.id,
      code: (error as any).code || "INTERNAL_ERROR",
    }),
  );
  return reply
    .code(500)
    .send({
      code: "BUSINESS_UNAVAILABLE",
      message: "业务服务暂时无法完成请求",
    });
});
app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { status: "ok", service: "business" };
});
app.get("/internal/capabilities", async () =>
  capabilities.map(({ execute, ...definition }) => definition),
);
app.get("/internal/openapi", async () => app.swagger());
const identitySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    role: Type.Union([Type.Literal("admin"), Type.Literal("customer")]),
    customerId: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
const errorSchema = Type.Object(
  { code: Type.String(), message: Type.String() },
  { additionalProperties: false },
);
for (const capability of capabilities) {
  app.post<{
    Body: {
      arguments: any;
      identity: any;
      mode: "read" | "preview" | "commit";
      commandId?: string;
      expectedPreviewHash?: string;
    };
  }>(
    `/v1/${capability.module}/${capability.name}`,
    {
      schema: {
        operationId: capability.name,
        summary: capability.label,
        description: capability.description,
        tags: [capability.module],
        body: Type.Object(
          {
            arguments: capability.input,
            identity: identitySchema,
            mode: Type.Union([
              Type.Literal("read"),
              Type.Literal("preview"),
              Type.Literal("commit"),
            ]),
            commandId: Type.Optional(
              Type.String({ minLength: 1, maxLength: 100 }),
            ),
            expectedPreviewHash: Type.Optional(
              Type.String({ pattern: "^[a-f0-9]{64}$" }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object(
            { data: resultSchema, requestId: Type.String() },
            { additionalProperties: false },
          ),
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req) => {
      const {
        arguments: args,
        identity,
        mode,
        commandId,
        expectedPreviewHash,
      } = req.body;
      if (
        !capability.roles.includes(identity.role) ||
        (identity.role === "customer" && !identity.customerId)
      )
        throw new BusinessError("FORBIDDEN", "当前身份没有此业务权限", 403);
      if (
        (capability.write && mode === "read") ||
        (!capability.write && mode !== "read")
      )
        throw new BusinessError("INVALID_MODE", "执行方式与业务能力不符");
      if (mode === "commit" && (!commandId || !expectedPreviewHash))
        throw new BusinessError("CONFIRMATION_REQUIRED", "请先准备并确认操作");
      const data = await transaction(pool, async (db) => {
        const context = { db, identity, preview: mode !== "commit" };
        const requestDigest = fingerprint({
          name: capability.name,
          args,
          identity: identity.id,
          expectedPreviewHash,
        });
        if (mode === "commit") {
          await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            commandId,
          ]);
          const existing = (
            await db.query("SELECT * FROM business.commands WHERE id=$1", [
              commandId,
            ])
          ).rows[0];
          if (existing) {
            if (
              existing.actor_id !== identity.id ||
              existing.request_digest !== requestDigest
            )
              throw new BusinessError(
                "IDEMPOTENCY_CONFLICT",
                "同一操作不能使用不同参数重复执行",
                409,
              );
            return existing.result;
          }
          const preview = await capability.execute(args, {
            ...context,
            preview: true,
          });
          if (fingerprint(preview) !== expectedPreviewHash)
            throw new BusinessError(
              "PREVIEW_CHANGED",
              "商品价格或业务状态已变化，请重新准备确认卡",
              409,
            );
        }
        const result = await capability.execute(args, context);
        if (!Value.Check(resultSchema, result))
          throw new BusinessError(
            "INVALID_RESULT",
            "业务结果格式校验失败",
            500,
          );
        if (mode === "commit")
          await db.query(
            "INSERT INTO business.commands(id,actor_id,capability,request_digest,result) VALUES($1,$2,$3,$4,$5)",
            [
              commandId,
              identity.id,
              capability.name,
              requestDigest,
              JSON.stringify(result),
            ],
          );
        return result;
      });
      return { data, requestId: req.id };
    },
  );
}
const address = await app.listen({ host: "127.0.0.1", port: 3181 });
console.log(`Business ready: ${address}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
