import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["DATABASE_PATH"] ?? "../../data/retr0vault.db",
  },
  strict: true,
  verbose: true,
});
