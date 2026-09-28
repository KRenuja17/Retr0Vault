import { openCliDatabase } from "./cli-connection.js";
import { clearDevelopmentData, seedDevelopmentData } from "./seed.js";

const shouldClear = process.argv.includes("--clear");
const { connection } = await openCliDatabase();

try {
  const result = shouldClear
    ? await clearDevelopmentData(connection.database)
    : await seedDevelopmentData(connection.database);
  const action = shouldClear ? "Removed" : "Seeded";
  process.stdout.write(
    `${action} ${result.designTypes} design types and ${result.collections} collections\n`,
  );
} finally {
  await connection.close();
}
