import {
  createPool,
  withClaims,
  withoutClaims,
  type Claims,
  type Queryable,
} from '@gymflow/database';
import type pg from 'pg';
import { env } from './env';

export type { Claims, Queryable };

let pool: pg.Pool | null = null;

/** Singleton pool as the restricted runtime role (RLS enforced). */
export function db(): pg.Pool {
  if (!pool) pool = createPool(env.databaseAppUrl);
  return pool;
}

/** Run work as an authenticated principal; RLS scopes every query. */
export function asPrincipal<T>(claims: Claims, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return withClaims(db(), claims, fn);
}

/** Run work with no principal (auth path only — SECURITY DEFINER functions). */
export function asAnonymous<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return withoutClaims(db(), fn);
}
