/** JSON-lines logging to stdout (plan 3.7: JSON logs on the VPS, rotated daily by Docker). */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function jsonLogger(write: (line: string) => void = (l) => process.stdout.write(l)): Logger {
  const out = (level: string, msg: string, fields?: Record<string, unknown>) =>
    write(`${JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields })}\n`);
  return {
    info: (m, f) => out('info', m, f),
    warn: (m, f) => out('warn', m, f),
    error: (m, f) => out('error', m, f),
  };
}
