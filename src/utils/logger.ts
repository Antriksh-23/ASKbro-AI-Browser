type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export function createScopedLogger(scope: string) {
  const prefix = `[ASKbro:${scope}]`;

  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
  };
}

export const logger = createScopedLogger('App');
