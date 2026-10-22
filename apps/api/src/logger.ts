import pino from 'pino';

export function makeLogger(level = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.idNumber',
        '*.id_number',
        '*.secret',
        'token',
        'password',
        'idNumber',
      ],
      censor: '[redacted]',
    },
  });
}
export type Logger = ReturnType<typeof makeLogger>;
