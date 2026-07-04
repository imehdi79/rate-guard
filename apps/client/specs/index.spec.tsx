import React from 'react';
import { render, screen } from '@testing-library/react';
import Dashboard from '../src/app/page';

const tenant = {
  id: 'tenant-1',
  name: 'acme',
  created_at: '2026-07-01T00:00:00.000Z',
  quotaConfigs: { max_requests: 10, window_seconds: 30 },
};

const stats = {
  tenantId: 'tenant-1',
  name: 'acme',
  quota: { max_requests: 10, window_seconds: 30, configured: true },
  usage: { current: 4, remaining: 6 },
  violations: {
    last_24h: 7,
    recent: [
      {
        id: 'v-1',
        request_id: 'req-abc',
        path: '/api',
        created_at: '2026-07-04T10:00:00.000Z',
      },
    ],
  },
};

const jsonResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);

describe('Dashboard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows an empty state when no tenants exist', async () => {
    global.fetch = jest.fn(() => jsonResponse([]));

    render(<Dashboard />);

    expect(
      await screen.findByText(/no tenants yet/i, { exact: false }),
    ).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/tenants');
  });

  it('auto-selects the first tenant and renders its polled stats', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) =>
      String(input).includes('/stats')
        ? jsonResponse(stats)
        : jsonResponse([tenant]),
    ) as jest.Mock;

    render(<Dashboard />);

    // Tenant selector filled and first tenant selected.
    expect(
      await screen.findByRole('option', { name: 'acme' }),
    ).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant-1/stats',
    );

    // Usage bar numbers, 24h violation count and the violations table.
    expect(await screen.findByText('4')).toBeTruthy();
    expect(screen.getByText('/ 10')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('req-abc')).toBeTruthy();
    expect(screen.getByText('/api')).toBeTruthy();
  });
});
