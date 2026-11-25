import { execSync } from "node:child_process";
import pg from "pg";

/**
 * Prepares the dedicated test database: apply migrations, empty every table, re-seed demo data.
 * Refuses to run against any database whose name doesn't end in "_test".
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://smile:smile_dev_password@localhost:5433/smile_dental_test";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to wipe non-test database "${dbName}"`);

  const env = { ...process.env, DATABASE_URL: url, SEED_DEMO: "true", NODE_ENV: "test" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await client.end();

  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
