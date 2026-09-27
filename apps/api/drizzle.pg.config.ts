import { defineConfig } from "drizzle-kit";

/*
 * Phase C: the Postgres schema and its migrations. Generating migrations needs
 * no database connection; they are applied by the API's migration runner.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/pg/schema.ts",
  out: "./drizzle-pg",
  strict: true,
  verbose: true,
});
