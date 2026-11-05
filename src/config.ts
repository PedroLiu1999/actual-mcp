import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

const redirectUriSchema = z.string().url().refine((val) => {
  try {
    const url = new URL(val);
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      return url.protocol === 'http:' || url.protocol === 'https:';
    }
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}, {
  message: 'Redirect URIs must use https:// unless targeting loopback (localhost or 127.0.0.1)',
});

const configSchema = z.object({
  PUBLIC_URL: z
    .string()
    .trim()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  LOGO_URL: z
    .string()
    .trim()
    .url()
    .optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: nonEmptyString,
  OAUTH_ADMIN_PASSWORD: nonEmptyString,
  OAUTH_ALLOWED_REDIRECT_URIS: z
    .string()
    .default('http://localhost,http://127.0.0.1')
    .transform((raw) => {
      if (!raw || raw.trim() === '') return ['http://localhost', 'http://127.0.0.1'];
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    })
    .pipe(z.array(redirectUriSchema)),
  ACTUAL_SERVER_URL: z
    .string()
    .trim()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  ACTUAL_PASSWORD: nonEmptyString,
  ACTUAL_SYNC_ID: nonEmptyString,
  ACTUAL_ENCRYPTION_PASSWORD: z
    .string()
    .optional()
    .transform((val) => (val && val.trim() !== '' ? val : undefined)),
  SYNC_TTL_SECONDS: z.coerce.number().int().min(0).default(30),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid startup configuration: ${details}`);
  }
  return result.data;
}
