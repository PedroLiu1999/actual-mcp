function parseCommaSeparatedList(val: unknown): string[] | undefined {
  if (Array.isArray(val)) {
    return val.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

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
    const parsed = parseCommaSeparatedList(record.redirect_uris);
    if (parsed) {
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

  // 3. Normalize grant_types, response_types, contacts
  if (record.grant_types !== undefined) {
    const parsed = parseCommaSeparatedList(record.grant_types);
    if (parsed) {
      record.grant_types = parsed;
    }
  }
  if (record.response_types !== undefined) {
    const parsed = parseCommaSeparatedList(record.response_types);
    if (parsed) {
      record.response_types = parsed;
    }
  }
  if (record.contacts !== undefined) {
    const parsed = parseCommaSeparatedList(record.contacts);
    if (parsed) {
      record.contacts = parsed;
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
