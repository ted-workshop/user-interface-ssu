import { createApp } from "./app";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3000,
  fetch: createApp().fetch,
});

console.info(`Qletter API: ${server.url}health`);
