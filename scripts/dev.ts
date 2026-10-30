import { spawn } from "node:child_process";
const node = process.execPath;
const children: ReturnType<typeof spawn>[] = [];
async function waitFor(url: string) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Service failed to start: ${url}`);
}
function launch(args: string[]) {
  const child = spawn(node, args, { stdio: "inherit", windowsHide: true });
  children.push(child);
  child.on("exit", (code) => {
    if (code) console.error(`Service stopped with code ${code}`);
  });
  return child;
}
launch(["node_modules/tsx/dist/cli.mjs", "apps/business/server.ts"]);
await waitFor("http://127.0.0.1:3181/health");
launch(["node_modules/tsx/dist/cli.mjs", "apps/agent/server.ts"]);
await waitFor("http://127.0.0.1:3180/api/health");
launch([
  "node_modules/vite/bin/vite.js",
  "--config",
  "apps/web/vite.config.ts",
]);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    children.forEach((c) => c.kill());
    process.exit(0);
  });
