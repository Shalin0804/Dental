import { defineConfig } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://smile:smile_dev_password@localhost:5433/smile_dental_test";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    globalSetup: ["./test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB,
      JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789",
      JWT_REFRESH_SECRET: "test-refresh-secret-0123456789abcdef0123456789",
      APP_URL: "http://localhost:5173",
      RAZORPAY_KEY_ID: "",
      RAZORPAY_KEY_SECRET: "",
      RAZORPAY_WEBHOOK_SECRET: "whsec_test",
    },
  },
});
