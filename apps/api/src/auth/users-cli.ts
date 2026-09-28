import { createInterface } from "node:readline";

import { openCliDatabase } from "../database/cli-connection.js";
import { adoptUnowned, createUser, findUserByUsername, listUsers, setPassword } from "../services/users.js";

/*
 * `npm run users -- <command>`: accounts for the vault.
 *
 *   list                                   every account and what it owns
 *   create <username> [--adopt-unowned]    a new account; optionally give it every unowned reference
 *   password <username>                    a new password (signs the account out everywhere)
 *   adopt <username>                       give the account every unowned reference and collection
 *
 * A password is never an argument, so it stays out of shell history: it is
 * asked for (hidden), or read from RETR0VAULT_PASSWORD when scripted.
 */

const usage = "Usage: npm run users -- list | create <username> [--adopt-unowned] | password <username> | adopt <username>";

async function askPassword(prompt: string): Promise<string> {
  const scripted = process.env["RETR0VAULT_PASSWORD"];
  if (scripted !== undefined && scripted !== "") return scripted;
  if (!process.stdin.isTTY) throw new Error("No terminal to ask for a password in; set RETR0VAULT_PASSWORD instead");
  const ask = (question: string) => new Promise<string>((resolve) => {
    const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Echo nothing while the password is typed.
    (readline as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text: string) => {
      if (text.startsWith(question)) process.stdout.write(question);
    };
    readline.question(question, (answer) => {
      readline.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
  const first = await ask(prompt);
  const second = await ask("Again, to confirm: ");
  if (first !== second) throw new Error("The two passwords differ; nothing was changed");
  return first;
}

const say = (line: string) => process.stdout.write(`${line}\n`);
const [command, username, ...flags] = process.argv.slice(2);

const { connection } = await openCliDatabase();
try {
  const db = connection.database;
  if (command === "list" && username === undefined) {
    const rows = await listUsers(db);
    if (rows.length === 0) say("No accounts yet.");
    for (const row of rows) say(`${row.username.padEnd(24)} ${row.references} references, ${row.collections} collections, since ${row.createdAt.toISOString().slice(0, 10)}`);
  } else if (command === "create" && username !== undefined && flags.every((flag) => flag === "--adopt-unowned")) {
    const user = await createUser(db, username, await askPassword(`Password for ${username}: `));
    say(`Created ${user.username}.`);
    if (flags.includes("--adopt-unowned")) {
      const adopted = await adoptUnowned(db, user.id);
      say(`${user.username} now owns ${adopted.references} unowned references and ${adopted.collections} collections.`);
    }
  } else if ((command === "password" || command === "adopt") && username !== undefined && flags.length === 0) {
    const user = await findUserByUsername(db, username);
    if (user === undefined) throw new Error(`No account named ${username}`);
    if (command === "password") {
      await setPassword(db, user.id, await askPassword(`New password for ${user.username}: `));
      say(`Password changed; ${user.username} is signed out everywhere.`);
    } else {
      const adopted = await adoptUnowned(db, user.id);
      say(`${user.username} now owns ${adopted.references} unowned references and ${adopted.collections} collections.`);
    }
  } else {
    process.stderr.write(`${usage}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await connection.close();
}
