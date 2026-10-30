export interface SSEFrame {
  id?: string;
  event?: string;
  data: string;
}

// Handles UTF-8 and line endings split across arbitrary network chunks.
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SSEFrame) => void | Promise<void>,
  onActivity?: () => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [],
    id: string | undefined,
    event: string | undefined;
  async function line(value: string) {
    if (!value) {
      if (data.length) await onFrame({ id, event, data: data.join("\n") });
      data = [];
      id = undefined;
      event = undefined;
      return;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "");
    if (field === "data") data.push(content);
    if (field === "id" && !content.includes("\0")) id = content;
    if (field === "event") event = content;
  }
  try {
    while (true) {
      const chunk = await reader.read();
      onActivity?.();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        await line(buffer.slice(0, boundary).replace(/\r$/, ""));
        buffer = buffer.slice(boundary + 1);
      }
      if (buffer.length > 262144) throw new Error("Event frame is too large");
      if (chunk.done) break;
    }
    // An incomplete final event is deliberately not dispatched.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
