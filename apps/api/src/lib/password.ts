import { Algorithm, hash, parseOptions, verify } from "@node-rs/argon2";

/**
 * Password hashing for admin accounts.
 *
 * We use **Argon2id** (the hybrid Argon2 variant recommended by OWASP for
 * password storage) through `@node-rs/argon2`, a Rust binding that ships
 * prebuilt binaries for every target we care about — including
 * `@node-rs/argon2-win32-x64-msvc` — so no node-gyp, Python or Visual Studio
 * toolchain is needed on a developer's Windows machine.
 *
 * The parameters below are deliberately stronger than the library defaults
 * (19 MiB / t=2 / p=1, the OWASP *minimum*). They are stored inside every hash
 * string (`$argon2id$v=19$m=65536,t=3,p=1$...`), so a future change here only
 * affects *new* hashes; existing hashes keep verifying because `verify` reads
 * the parameters back out of the stored string.
 *
 * No custom cryptography lives here: we only call the library's `hash` and
 * `verify`.
 */

/** Shortest password we will store. Also rejects the empty string. */
export const MIN_PASSWORD_LENGTH = 12;

/** Argon2id, 64 MiB of memory, 3 passes, 1 lane, 32-byte digest. */
const HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536, // 64 MiB (Kibibytes), per lane
  timeCost: 3, // passes over memory
  parallelism: 1, // single lane: deterministic cost, no lane-count tuning needed
  outputLen: 32, // 256-bit digest
} as const;

/**
 * Hashes a plaintext password for storage. The returned PHC string carries its
 * own parameters and salt, so it is safe to keep in `admin_users."passwordHash"`
 * and never needs a separate salt column.
 *
 * Throws when the password is shorter than `MIN_PASSWORD_LENGTH` (an empty
 * string included); the message never contains the password itself.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }

  return hash(plain, HASH_OPTIONS);
}

/**
 * Checks a plaintext password against a stored hash. Returns `false` when the
 * hash is malformed or was produced by a different scheme, so a corrupted row
 * is a failed sign-in rather than a crash.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (plain.length === 0) {
    return false;
  }

  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * True when `value` is a well-formed **Argon2id** PHC hash (rejects argon2d,
 * argon2i and anything that is not a hash at all). Used by the admin seed to
 * validate `ADMIN_PASSWORD_HASH` before it is written to the database.
 */
export function isArgon2idHash(value: string): boolean {
  try {
    return parseOptions(value).algorithm === Algorithm.Argon2id;
  } catch {
    return false;
  }
}
