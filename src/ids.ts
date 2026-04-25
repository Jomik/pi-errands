import { randomBytes } from "node:crypto";

// Crockford base32: lowercase, no I/L/O/U
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i] & 0x1f];
  }
  return result;
}

export function newPlanId(): string {
  return `p_${randomBase32(8)}`;
}

export function newErrandId(): string {
  return `e_${randomBase32(8)}`;
}

export function newChoreId(): string {
  return `c_${randomBase32(8)}`;
}
