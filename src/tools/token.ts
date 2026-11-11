/** Per-call capability token (blueprint §6.3): Ed25519-signed claims, never placed in the model's context. */
import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { ToolError } from './errors.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
export type CallClaims = { tenant_id: string; location_id: string; conversation_id: string; config_version: number;
  ani: string | null; lang: 'th' | 'en'; jurisdiction: 'TH' | 'US'; exp: number; jti: string };

export function mintCallToken(c: Omit<CallClaims, 'exp' | 'jti'>, now: Date, ttlMs = 15 * 60_000): string {
  const claims: CallClaims = { ...c, exp: now.getTime() + ttlMs, jti: randomUUID() };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
}

export function verifyCallToken(token: string, now: Date): CallClaims {
  const [body, sig] = token.split('.');
  if (!body || !sig || !verify(null, Buffer.from(body), publicKey, Buffer.from(sig, 'base64url'))) throw new ToolError('AUTH_EXPIRED', 'bad call token');
  const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as CallClaims;
  if (c.exp < now.getTime()) throw new ToolError('AUTH_EXPIRED', 'call token expired');
  return c;
}
