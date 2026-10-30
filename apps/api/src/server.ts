import { createApp } from "./app";
import { runBackgroundJobs } from "./jobs/runner";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    await runBackgroundJobs(env);
  },
} satisfies ExportedHandler<Env>;
