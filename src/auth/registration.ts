/**
 * Parses a comma-separated string or array into a clean list of trimmed strings.
 */
export function parseList(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

const LIST_KEYS = ['grant_types', 'response_types', 'contacts'] as const;

const EMPTY_URL_KEYS = [
  'client_uri',
  'logo_uri',
  'tos_uri',
  'policy_uri',
  'jwks_uri',
] as const;

/**
 * Normalizes incoming OAuth Dynamic Client Registration (RFC 7591) request bodies
 * to accommodate common client formatting quirks (e.g. Google OpenAuth, form-encoded posts).
 */
export function normalizeRegistrationBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const record = { ...(body as Record<string, unknown>) };

  // 1. Normalize singular redirect_uri or comma-separated redirect_uris to array
  if (record.redirect_uri && !record.redirect_uris) {
    record.redirect_uris = [String(record.redirect_uri)];
  } else if (record.redirect_uris !== undefined) {
    const parsed = parseList(record.redirect_uris);
    if (parsed.length > 0) {
      record.redirect_uris = parsed;
    }
  }

  // 2. Normalize scope / scopes (array or string to space-separated string)
  if (Array.isArray(record.scope)) {
    record.scope = record.scope.map((s) => String(s).trim()).filter(Boolean).join(' ');
  } else if (!record.scope && Array.isArray(record.scopes)) {
    record.scope = record.scopes.map((s) => String(s).trim()).filter(Boolean).join(' ');
  } else if (!record.scope && typeof record.scopes === 'string') {
    record.scope = record.scopes;
  }

  // 3. Normalize list properties (grant_types, response_types, contacts)
  for (const key of LIST_KEYS) {
    if (record[key] !== undefined) {
      const parsed = parseList(record[key]);
      if (parsed.length > 0) {
        record[key] = parsed;
      }
    }
  }

  // 4. Remove empty string fields that fail Zod url validation
  for (const key of EMPTY_URL_KEYS) {
    if (record[key] === '') {
      delete record[key];
    }
  }

  return record;
}

/**
 * Extracts candidate redirect URIs from a normalized registration body.
 */
export function extractCandidateRedirectUris(body: unknown): string[] {
  if (body && typeof body === 'object') {
    const uris = (body as Record<string, unknown>).redirect_uris;
    if (Array.isArray(uris)) {
      return uris.filter((u): u is string => typeof u === 'string');
    }
  }
  return [];
}
