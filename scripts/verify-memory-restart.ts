import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const path = "output/conversation-memory-restart-verification.json";
const capture = process.argv[2] === "capture";
const previous = capture ? null : JSON.parse(readFileSync(path, "utf8"));
const report = JSON.parse(
  readFileSync("output/conversation-memory-verification.json", "utf8"),
);
const conversationId =
  previous?.conversationId ??
  report.reports.find((r: any) => r.message).conversationId;
const password = readFileSync(".local/登录账号.txt", "utf8").match(
  /初始密码：([^\r\n]+)/,
)![1];
const login = await fetch("http://127.0.0.1:5180/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-client": "shop" },
  body: JSON.stringify({ login: "zhixia", password }),
});
assert.equal(login.status, 200);
const response = await fetch(
  `http://127.0.0.1:5180/api/conversations/${conversationId}/memory`,
  {
    headers: {
      "x-client": "shop",
      cookie: login.headers.get("set-cookie")!.split(";")[0],
    },
  },
);
assert.equal(response.status, 200);
const memory = await response.json();
if (!capture) assert.deepEqual(memory, previous.memory);
writeFileSync(
  path,
  JSON.stringify(
    {
      conversationId,
      memory,
      capturedAt: previous?.capturedAt ?? new Date().toISOString(),
      checkedAt: capture ? null : new Date().toISOString(),
      status: capture ? "captured-before-restart" : "passed-after-restart",
    },
    null,
    2,
  ),
);
console.log(
  capture
    ? "Captured memory through authenticated HTTP before restart."
    : "PASS: identical conversation memory and references through HTTP after service restart.",
);
