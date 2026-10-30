import { readSSE } from "../../../../shared/sse";
import type { ProgressEvent } from "../../../../shared/events";
export type { ProgressEvent } from "../../../../shared/events";
export async function streamProgress(
  channel: string,
  conversationId: string,
  afterId: string,
  signal: AbortSignal,
  onEvent: (event: ProgressEvent) => void,
  onReady: () => void,
) {
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), 45000);
  };
  touch();
  try {
    const response = await fetch(
      `/api/conversations/${conversationId}/events/stream`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "text/event-stream",
          "content-type": "application/json",
          "x-client": channel,
        },
        body: JSON.stringify({ afterId }),
        signal: AbortSignal.any([signal, idle.signal]),
      },
    );
    if (!response.ok)
      throw Object.assign(new Error("实时进度连接失败"), {
        status: response.status,
      });
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      throw new Error("未收到有效的实时进度通道");
    await readSSE(
      response.body,
      (frame) => {
        const event = JSON.parse(frame.data);
        if (event.conversationId !== conversationId)
          throw new Error("实时进度所属对话不一致");
        if (event.type === "stream-ready") {
          onReady();
          return;
        }
        if (
          typeof event.id !== "string" ||
          !/^\d+$/.test(event.id) ||
          typeof event.title !== "string" ||
          typeof event.detail !== "string" ||
          typeof event.occurredAt !== "string"
        )
          throw new Error("实时进度格式异常");
        onEvent(event);
      },
      touch,
    );
  } finally {
    clearTimeout(timer!);
  }
}
