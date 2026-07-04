const API_URL = process.env.RATE_GUARD_API_URL ?? 'http://localhost:3001';

/**
 * Server-side proxy to the rate-guard admin API. Only ever runs inside
 * Next.js route handlers, so ADMIN_API_KEY stays out of the browser bundle
 * (it is deliberately not a NEXT_PUBLIC_ variable).
 */
async function proxyAdmin(path: string, init: RequestInit): Promise<Response> {
  try {
    const upstream = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: 'no-store',
    });
    return Response.json(await upstream.json(), { status: upstream.status });
  } catch {
    return Response.json(
      { message: `rate-guard API is unreachable at ${API_URL}` },
      { status: 502 },
    );
  }
}

export function proxyAdminGet(path: string): Promise<Response> {
  return proxyAdmin(path, {
    headers: { 'x-admin-key': process.env.ADMIN_API_KEY ?? '' },
  });
}

/** Forwards the raw JSON body; upstream Nest validation owns the 400s. */
export function proxyAdminPut(path: string, body: string): Promise<Response> {
  return proxyAdmin(path, {
    method: 'PUT',
    headers: {
      'x-admin-key': process.env.ADMIN_API_KEY ?? '',
      'content-type': 'application/json',
    },
    body,
  });
}
