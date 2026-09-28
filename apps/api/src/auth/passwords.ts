import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/*
 * Passwords are kept only as scrypt hashes: `scrypt$N$r$p$<salt>$<hash>`, with
 * the salt and hash in base64. The parameters travel with the hash, so they
 * can be raised later without invalidating existing accounts.
 */

const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 256;

function derive(password: string, salt: Buffer, options: ScryptOptions & { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, KEY_LENGTH, { ...options, maxmem: 128 * options.N * options.r * 2 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, blockSize, parallelism, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || salt === undefined || hash === undefined) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), {
    N: Number(cost), r: Number(blockSize), p: Number(parallelism),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let decoy: Promise<string> | undefined;

/**
 * Spends the same effort as checking a real password, so a missing account
 * cannot be told apart from a wrong password by how long the answer takes.
 */
export async function spendVerificationTime(password: string): Promise<void> {
  decoy ??= hashPassword("retr0vault-decoy");
  await verifyPassword(password, await decoy);
}
