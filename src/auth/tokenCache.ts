import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { jwtExpiry } from './jwt.js';

export const AUTH_FILE = 'auth.json';

export interface CachedToken {
  readonly token: string;
  /** ISO time from the JWT `exp` claim, when it has one. */
  readonly expiresAt?: string;
  readonly savedAt: string;
}

/**
 * Directory for eXF1LT's own files: `%APPDATA%\eXF1LT` on Windows,
 * `$XDG_CONFIG_HOME/exf1lt` (default `~/.config/exf1lt`) elsewhere.
 * `EXF1LT_CONFIG_DIR` overrides both.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env['EXF1LT_CONFIG_DIR']) return env['EXF1LT_CONFIG_DIR'];
  if (platform === 'win32') return join(env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'eXF1LT');
  return join(env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'exf1lt');
}

export async function readCachedToken(dir: string): Promise<CachedToken | undefined> {
  let text: string;
  try {
    text = await readFile(join(dir, AUTH_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<CachedToken>;
    return typeof parsed.token === 'string' && typeof parsed.savedAt === 'string'
      ? (parsed as CachedToken)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCachedToken(dir: string, token: string, now = Date.now()): Promise<CachedToken> {
  const expiry = jwtExpiry(token);
  const cached: CachedToken = {
    token,
    ...(expiry === undefined ? {} : { expiresAt: new Date(expiry).toISOString() }),
    savedAt: new Date(now).toISOString(),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, AUTH_FILE), `${JSON.stringify(cached, null, 2)}\n`, { mode: 0o600 });
  return cached;
}

export async function clearCachedToken(dir: string): Promise<boolean> {
  try {
    await rm(join(dir, AUTH_FILE));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
