import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.QIHE_WEB_PORT || 5180),
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${process.env.QIHE_AGENT_PORT || 3180}`,
    },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
