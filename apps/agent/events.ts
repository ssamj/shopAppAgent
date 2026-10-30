import type pg from "pg";
import { EventEmitter } from "node:events";
import type { ProgressEvent, ProgressInput } from "../../shared/events.ts";
const hub = new EventEmitter();
hub.setMaxListeners(0);
const queues = new Map<string, Promise<unknown>>();
export function subscribe(
  conversationId: string,
  listener: (event: ProgressEvent) => void,
) {
  hub.on(conversationId, listener);
  return () => {
    hub.off(conversationId, listener);
  };
}
export function progress(
  pool: pg.Pool,
  input: ProgressInput,
): Promise<ProgressEvent> {
  const previous = queues.get(input.conversationId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const row = (
        await pool.query(
          "INSERT INTO agent.events(conversation_id,run_id,payload) VALUES($1,$2,$3) RETURNING id::text,created_at",
          [input.conversationId, input.runId, JSON.stringify(input)],
        )
      ).rows[0];
      const event: ProgressEvent = {
        ...input,
        id: row.id,
        occurredAt: row.created_at.toISOString(),
      };
      hub.emit(input.conversationId, event);
      return event;
    });
  queues.set(input.conversationId, next);
  void next
    .finally(() => {
      if (queues.get(input.conversationId) === next)
        queues.delete(input.conversationId);
    })
    .catch(() => {});
  return next;
}
export function storedEvent(row: any): ProgressEvent {
  return {
    ...row.payload,
    id: String(row.id),
    occurredAt: new Date(row.created_at).toISOString(),
  };
}
