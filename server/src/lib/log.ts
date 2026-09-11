type Level = 'info' | 'warn' | 'error';

function write(level: Level, scope: string, message: string, extra?: unknown) {
  if (process.env.VITEST) return; // silencio durante los tests
  const time = new Date().toISOString().slice(11, 19);
  const line = `[${time}] ${level.toUpperCase().padEnd(5)} ${scope.padEnd(8)} ${message}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra === undefined) out(line);
  else out(line, extra);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, extra?: unknown) => write('info', scope, message, extra),
    warn: (message: string, extra?: unknown) => write('warn', scope, message, extra),
    error: (message: string, extra?: unknown) => write('error', scope, message, extra),
  };
}
