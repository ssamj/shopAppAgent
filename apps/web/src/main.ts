import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import Workspace from "./Workspace.vue";
import "./style.css";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/admin" },
    { path: "/admin", component: Workspace, props: { channel: "admin" } },
    { path: "/shop", component: Workspace, props: { channel: "shop" } },
    { path: "/:pathMatch(.*)*", redirect: "/admin" },
  ],
});
createApp(App).use(router).mount("#app");
