/** Minimal strict JSON-Schema subset for model arguments: object, required, additionalProperties:false, types, enum, maxLength. */
import { ToolError } from './errors.ts';

export type Schema = { type: 'object'; required?: string[]; properties: Record<string, Prop> };
export type Prop = { type: 'string' | 'integer' | 'boolean' | 'object'; enum?: readonly string[]; maxLength?: number; minimum?: number; maximum?: number; properties?: Record<string, Prop>; required?: string[] };

function check(v: unknown, p: Prop, path: string) {
  const bad = (why: string) => { throw new ToolError('VALIDATION_FAILED', `${path}: ${why}`); };
  if (p.type === 'string') {
    if (typeof v !== 'string') bad('not a string');
    if (p.maxLength !== undefined && (v as string).length > p.maxLength) bad('too long');
    if (p.enum && !p.enum.includes(v as string)) bad('not allowed');
  } else if (p.type === 'integer') {
    if (!Number.isInteger(v)) bad('not an integer');
    if (p.minimum !== undefined && (v as number) < p.minimum) bad('too small');
    if (p.maximum !== undefined && (v as number) > p.maximum) bad('too large');
  } else if (p.type === 'boolean') {
    if (typeof v !== 'boolean') bad('not a boolean');
  } else if (p.type === 'object') {
    validate(v, { type: 'object', properties: p.properties ?? {}, required: p.required }, path);
  }
}

export function validate(v: unknown, s: Schema, path = 'args') {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ToolError('VALIDATION_FAILED', `${path}: not an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(k in s.properties)) throw new ToolError('VALIDATION_FAILED', `${path}: unexpected field ${k}`);
  for (const k of s.required ?? []) if (!(k in o)) throw new ToolError('VALIDATION_FAILED', `${path}: missing ${k}`);
  for (const [k, p] of Object.entries(s.properties)) if (k in o) check(o[k], p, `${path}.${k}`);
}
