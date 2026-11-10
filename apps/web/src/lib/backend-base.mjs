/** Validate the private API destination before forwarding a Supabase access token. */
export function resolveBackend(value, supabaseUrl, environment = 'production') {
  if (!value) return null;
  try {
    const actual = new URL(value);
    if (actual.username || actual.password || actual.search || actual.hash) return null;
    if (actual.protocol === 'https:' && actual.pathname === '/functions/v1/ci-api') {
      const expected = new URL(supabaseUrl || '');
      if (expected.protocol === 'https:' && actual.hostname === expected.hostname &&
          actual.port === '' && actual.hostname.endsWith('.supabase.co'))
        return actual.origin + actual.pathname;
    }
    if (environment !== 'production' && actual.protocol === 'http:' &&
        ['localhost','127.0.0.1'].includes(actual.hostname) && actual.pathname === '/')
      return actual.origin;
  } catch {}
  return null;
}
