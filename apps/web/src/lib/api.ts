export async function api<T = any>(
  channel: string,
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", "x-client": channel },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || "请求未完成") as Error & {
      code: string;
    };
    error.code = data.code;
    throw error;
  }
  return data;
}
export function currency(value: unknown) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(Number(value || 0) / 100);
}
export function time(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export interface BusinessCard {
  title: string;
  view: string;
  capability?: string;
  referenceId?: string;
  summary?: string;
  columns: { key: string; label: string; format?: string }[];
  rows: Record<string, any>[];
  details: { label: string; value: any }[];
}
