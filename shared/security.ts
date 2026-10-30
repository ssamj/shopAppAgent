import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, value: string) {
  const [salt, hash] = value.split(":");
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
export function token() {
  return randomBytes(32).toString("hex");
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function fingerprint(value: unknown): string {
  const normalize = (v: any): any =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .filter((k) => v[k] !== undefined)
              .sort()
              .map((k) => [k, normalize(v[k])]),
          )
        : v;
  return digest(JSON.stringify(normalize(value)));
}
export interface Identity {
  id: string;
  name: string;
  role: "customer" | "admin";
  customerId: string | null;
}
