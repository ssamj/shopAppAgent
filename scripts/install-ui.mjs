import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const names = [
  "button",
  "input",
  "textarea",
  "badge",
  "card",
  "dialog",
  "tabs",
  "table",
  "label",
  "separator",
  "scroll-area",
  "tooltip",
];
const deps = new Set();
for (const name of names) {
  const response = await fetch(
    `https://www.shadcn-vue.com/r/styles/new-york-v4/${name}.json`,
  );
  if (!response.ok) throw new Error(`Component ${name}: ${response.status}`);
  const registry = await response.json();
  for (const d of registry.dependencies || []) deps.add(d);
  for (const file of registry.files || []) {
    const marker = "/ui/";
    const suffix = file.path.slice(file.path.indexOf(marker) + marker.length);
    const target = `apps/web/src/components/ui/${suffix}`;
    mkdirSync(dirname(target), { recursive: true });
    const content = file.content
      .replaceAll("@/registry/new-york-v4/ui/", "@/components/ui/")
      .replaceAll("@/registry/new-york-v4/utils", "@/lib/utils")
      .replaceAll('from "cn"', 'from "@/lib/utils"')
      .replaceAll('from "@lucide/vue"', 'from "lucide-vue-next"')
      .replaceAll(">Close<", ">关闭<");
    writeFileSync(target, content);
  }
  console.log(`Installed official shadcn-vue component: ${name}`);
}
console.log(JSON.stringify({ dependencies: [...deps] }));
