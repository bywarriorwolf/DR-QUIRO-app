/** Tiny file logger. Never pass tokens, codes or URLs with secrets to it. */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let file: string | null = null;

export function initLog(dir: string) {
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'main.log');
}

export function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg.replace(/(access_token|refresh_token|code)=[^&\s]+/gi, '$1=***')}\n`;
  if (process.env.NODE_ENV !== 'production') process.stdout.write(line);
  if (file) {
    try {
      appendFileSync(file, line);
    } catch {
      /* ignore */
    }
  }
}
