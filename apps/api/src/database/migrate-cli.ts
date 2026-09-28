import { describeDatabase, openCliDatabase } from "./cli-connection.js";

const { config, connection } = await openCliDatabase();
try {
  process.stdout.write(`Migrations applied to ${describeDatabase(config.databaseUrl)}\n`);
} finally {
  await connection.close();
}
