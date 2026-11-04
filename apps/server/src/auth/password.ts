import bcrypt from "bcrypt";

/**
 * A valid bcrypt hash for a throwaway password. Comparing against it when an
 * email is unknown keeps response timing close to the real login path.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$xz//9DT/5fMCy3.fJjWoIeXzn29Us..GQSO08uHYiL8Pv.HNxkF4S";

export async function hashPassword(password: string, cost: number): Promise<string> {
  return bcrypt.hash(password, cost);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function verifyDummyPassword(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
}
