import { createServer } from "node:http";
import { createApp } from "./app.js";
import { prisma } from "./config/db.js";
import { env } from "./config/env.js";
import { mountModules } from "./modules/index.js";
import { startNotificationWorker } from "./services/notify.js";
import { initRealtime } from "./services/realtime.js";
import { logger } from "./utils/logger.js";

const app = createApp(mountModules);
const server = createServer(app);
initRealtime(server);
const worker = startNotificationWorker();

server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(worker);
    server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
  });
}
