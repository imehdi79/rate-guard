import axios from 'axios';

/**
 * Security headers (helmet) and the CORS origin allowlist. CORS_ORIGINS
 * comes from apps/server/.env — the same file the server under test loads.
 */
describe('security headers & CORS (e2e)', () => {
  const allowedOrigin = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)[0];

  it('sets CSP, frame, sniff and HSTS headers on every response', async () => {
    const res = await axios.get('/api/health', { validateStatus: () => true });

    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain(
      'max-age=31536000',
    );
    expect(res.headers['strict-transport-security']).toContain(
      'includeSubDomains',
    );
  });

  it('covers /docs with the same headers', async () => {
    const res = await axios.get('/docs', { validateStatus: () => true });

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
  });

  it('allows cross-origin requests only from the allowlisted origins', async () => {
    // Guard: the e2e environment must define at least one allowed origin,
    // otherwise this suite cannot prove the allow path.
    expect(allowedOrigin).toBeTruthy();

    const allowed = await axios.get('/api/health', {
      headers: { Origin: allowedOrigin },
      validateStatus: () => true,
    });

    expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);
    // Never a wildcard.
    expect(allowed.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('sends no CORS headers for origins outside the allowlist', async () => {
    const denied = await axios.get('/api/health', {
      headers: { Origin: 'https://evil.example.com' },
      validateStatus: () => true,
    });

    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflights for allowlisted origins with scoped permissions', async () => {
    const res = await axios.options('/api/admin/tenants', {
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-admin-key',
      },
      validateStatus: () => true,
    });

    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    expect(res.headers['access-control-allow-headers']).toContain(
      'X-Admin-Key',
    );
  });
});
