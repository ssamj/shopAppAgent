import { config } from "../../shared/config.ts";
import { BusinessError } from "../../shared/db.ts";
import { readSSE } from "../../shared/sse.ts";
import type { DraftRevision } from "./actions.ts";
import { Value } from "@sinclair/typebox/value";
import { taskPlanSchema, type TaskPlan } from "../../shared/planning.ts";
import {
  answerBlocksSchema,
  type AnswerBlock,
} from "../../shared/knowledge.ts";
export interface Decision {
  analysisSummary?: string;
  needsClarification?: boolean;
  message: string;
  answerBlocks?: AnswerBlock[];
  plan?: TaskPlan;
  calls: {
    name: string;
    arguments: Record<string, unknown>;
    revision?: DraftRevision;
    stepId?: string;
  }[];
}
export async function decide(
  messages: { role: string; content: string }[],
  onSummary?: (summary: string, streaming: boolean) => Promise<void>,
): Promise<Decision> {
  const { content, finishReason } = await requestContent(messages, onSummary);
  const decision = parseDecision(content, finishReason);
  if (onSummary && decision.analysisSummary)
    await onSummary(decision.analysisSummary, false);
  return decision;
}

// Memory extraction uses the same transport, but never dispatches business tools.
export async function generateJson(
  messages: { role: string; content: string }[],
): Promise<unknown> {
  const { content, finishReason } = await requestContent(messages);
  if (finishReason === "length")
    throw new BusinessError(
      "MODEL_OUTPUT_LIMIT",
      "会话需求整理未完成，请重试",
      502,
    );
  try {
    return JSON.parse(content);
  } catch {
    throw new BusinessError(
      "MEMORY_RESULT_INVALID",
      "会话需求格式异常，请重试",
      502,
    );
  }
}

async function requestContent(
  messages: { role: string; content: string }[],
  onSummary?: (summary: string, streaming: boolean) => Promise<void>,
) {
  const model = config().model;
  const response = await fetch(
    `${model.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: 0.25,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        enable_thinking: false,
        thinking: { type: "disabled" },
        stream: true,
      }),
      signal: AbortSignal.timeout(90000),
    },
  ).catch((error) => {
    console.error(
      JSON.stringify({
        event: "model_connection_error",
        errorType: error?.name,
        causeCode: error?.cause?.code,
      }),
    );
    throw new BusinessError(
      "MODEL_CONNECTION_FAILED",
      "智能助手连接超时，请稍后重试",
      503,
    );
  });
  if (!response.ok)
    throw new BusinessError(
      "MODEL_REQUEST_FAILED",
      `智能助手暂时不可用（${response.status}）`,
      502,
    );
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new BusinessError(
      "MODEL_STREAM_INVALID",
      "智能助手未返回有效的实时响应",
      502,
    );
  let content = "",
    finishReason: string | undefined,
    sent = "",
    lastSentAt = 0;
  try {
    await readSSE(response.body, async (frame) => {
      if (frame.data === "[DONE]") return;
      const body = JSON.parse(frame.data);
      if (body.error) throw new Error("Upstream model stream failed");
      const choice = body.choices?.[0];
      if (typeof choice?.delta?.content === "string")
        content += choice.delta.content;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (content.length > 100000)
        throw new Error("Model response exceeds limit");
      const summary = partialSummary(content);
      if (
        onSummary &&
        summary &&
        summary !== sent &&
        Date.now() - lastSentAt >= 150
      ) {
        await onSummary(summary, true);
        sent = summary;
        lastSentAt = Date.now();
      }
    });
  } catch {
    throw new BusinessError(
      "MODEL_STREAM_INTERRUPTED",
      "智能助手的实时响应中断，请重新发送",
      502,
    );
  }
  if (!finishReason)
    throw new BusinessError(
      "MODEL_STREAM_INTERRUPTED",
      "智能助手的回复未完整接收，请重新发送",
      502,
    );
  return { content, finishReason };
}
export function partialSummary(content: string): string {
  const start = /^\s*(?:```json\s*)?\{\s*"analysisSummary"\s*:\s*"/.exec(
    content,
  );
  if (!start) return "";
  let result = "";
  for (
    let i = start[0].length;
    i < content.length && result.length < 600;
    i++
  ) {
    const c = content[i];
    if (c === '"') break;
    if (c !== "\\") {
      result += c;
      continue;
    }
    const escaped = content[++i];
    if (escaped === undefined) break;
    if (escaped === "u") {
      const hex = content.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      result += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else {
      const values: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
      };
      if (!(escaped in values)) break;
      result += values[escaped];
    }
  }
  return result.replace(/[\uD800-\uDBFF]$/, "");
}
export function parseDecision(
  content: unknown,
  finishReason?: string,
): Decision {
  if (finishReason === "length")
    throw new BusinessError(
      "MODEL_OUTPUT_LIMIT",
      "本次模型回复未完整生成，请缩小问题范围后重试",
      502,
    );
  if (typeof content !== "string")
    throw new BusinessError(
      "MODEL_RESULT_INVALID",
      "智能助手没有返回有效内容",
      502,
    );
  let parsed: Decision;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error(
      JSON.stringify({
        event: "model_format_error",
        finishReason,
        characters: content.length,
      }),
    );
    throw new BusinessError(
      "MODEL_RESULT_INVALID",
      "智能助手返回格式异常，请重新发送",
      502,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.message !== "string" ||
    (parsed.analysisSummary !== undefined &&
      typeof parsed.analysisSummary !== "string") ||
    (parsed.needsClarification !== undefined &&
      typeof parsed.needsClarification !== "boolean") ||
    !Array.isArray(parsed.calls) ||
    (parsed.plan !== undefined &&
      (!Value.Check(taskPlanSchema, parsed.plan) ||
        parsed.calls.length !== 1)) ||
    parsed.calls.length > 3 ||
    (!parsed.calls.length && !parsed.message.trim() && !parsed.answerBlocks) ||
    (parsed.answerBlocks !== undefined &&
      (!Value.Check(answerBlocksSchema, parsed.answerBlocks) ||
        parsed.calls.length > 0 ||
        parsed.message !== "")) ||
    parsed.calls.some(
      (c) =>
        !c ||
        typeof c.name !== "string" ||
        (c.stepId !== undefined && typeof c.stepId !== "string") ||
        !c.arguments ||
        typeof c.arguments !== "object" ||
        Array.isArray(c.arguments) ||
        (c.revision !== undefined &&
          (!c.revision ||
            typeof c.revision !== "object" ||
            Array.isArray(c.revision) ||
            typeof c.revision.actionId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              c.revision.actionId,
            ) ||
            !Number.isInteger(c.revision.version) ||
            c.revision.version < 1 ||
            Object.keys(c.revision).some(
              (key) => !["actionId", "version"].includes(key),
            ))),
    )
  ) {
    console.error(
      JSON.stringify({
        event: "model_shape_error",
        messageType: typeof parsed?.message,
        summaryType: typeof parsed?.analysisSummary,
        callsArray: Array.isArray(parsed?.calls),
        callsCount: parsed?.calls?.length,
        planErrors:
          parsed?.plan === undefined
            ? undefined
            : [...Value.Errors(taskPlanSchema, parsed.plan)].map((e) => ({
                path: e.path,
                message: e.message,
              })),
        answerBlocksPresent: parsed?.answerBlocks !== undefined,
        invalidCalls: Array.isArray(parsed?.calls)
          ? parsed.calls.map((c) => ({
              nameType: typeof c?.name,
              argumentsType: typeof c?.arguments,
              argumentsArray: Array.isArray(c?.arguments),
              stepIdType: typeof c?.stepId,
            }))
          : undefined,
      }),
    );
    throw new BusinessError(
      "MODEL_RESULT_INVALID",
      "智能助手返回格式异常",
      502,
    );
  }
  if (parsed.analysisSummary)
    parsed.analysisSummary = parsed.analysisSummary.slice(0, 600);
  return parsed;
}
