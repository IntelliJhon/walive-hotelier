import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      WEB_BASE_URL: "http://localhost:5173",
      PMS_BASE_URL: "http://pms.invalid",
      PMS_KEY: "test",
      PMS_GROUP_ID: "TEST",
      CHAT_API_SECRET: "test-secret-0123456789",
      ADMIN_USER: "admin",
      ADMIN_PASSWORD: "password123",
    },
  },
});
