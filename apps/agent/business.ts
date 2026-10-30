import { config } from "../../shared/config.ts";
import type { Identity } from "../../shared/security.ts";
import { BusinessError } from "../../shared/db.ts";
import type { Result, Capability } from "../business/contracts.ts";
export type Definition = Omit<Capability, "execute">;
let registry: Definition[] = [];
export async function definitions() {
  if (!registry.length) {
    const response = await fetch(
      "http://127.0.0.1:3181/internal/capabilities",
      {
        headers: { "x-service-key": config().internalSecret },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new BusinessError(
        "CAPABILITIES_UNAVAILABLE",
        "业务能力目录暂不可用",
        503,
      );
    registry = (await response.json()) as Definition[];
  }
  return registry;
}
export async function findCapability(name: string, identity: Identity) {
  const cap = (await definitions()).find(
    (x) => x.name === name && x.roles.includes(identity.role),
  );
  if (!cap)
    throw new BusinessError("FORBIDDEN", "当前身份不能执行此业务操作", 403);
  return cap;
}
export async function invoke(
  name: string,
  args: any,
  identity: Identity,
  mode: "read" | "preview" | "commit",
  commandId?: string,
  expectedPreviewHash?: string,
): Promise<Result> {
  const cap = await findCapability(name, identity);
  let response: Response;
  try {
    response = await fetch(
      `http://127.0.0.1:3181/v1/${cap.module}/${cap.name}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-key": config().internalSecret,
        },
        body: JSON.stringify({
          arguments: args,
          identity,
          mode,
          commandId,
          expectedPreviewHash,
        }),
        signal: AbortSignal.timeout(25000),
      },
    );
  } catch {
    throw new BusinessError(
      "BUSINESS_CONNECTION_FAILED",
      "业务服务连接中断，请稍后重试",
      503,
    );
  }
  const body = (await response.json()) as any;
  if (!response.ok)
    throw new BusinessError(
      body.code || "BUSINESS_ERROR",
      body.message || "业务操作未完成",
      response.status,
    );
  return body.data;
}
