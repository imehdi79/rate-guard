import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Dashboard from '../src/app/page';

const tenant = {
  id: 'tenant-1',
  name: 'acme',
  created_at: '2026-07-01T00:00:00.000Z',
  quotaConfigs: { max_requests: 10, window_seconds: 30 },
};

const initialStats = {
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
        ? jsonResponse(initialStats)
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
    expect(screen.getByRole('button', { name: '/ 10' })).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('req-abc')).toBeTruthy();
    expect(screen.getByText('/api')).toBeTruthy();
  });

  it('saves an inline quota edit and shows the new limit immediately', async () => {
    // Stateful mock: after the PUT, the stats endpoint reports the new
    // limit — like the real server — so the post-save refetch agrees.
    let stats = initialStats;
    const fetchMock = jest.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          stats = {
            ...stats,
            quota: { ...stats.quota, max_requests: body.max_requests },
          };
          return jsonResponse({
            tenantId: 'tenant-1',
            max_requests: body.max_requests,
            window_seconds: body.window_seconds,
            configured: true,
          });
        }
        if (url.includes('/stats')) return jsonResponse(stats);
        return jsonResponse([tenant]);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<Dashboard />);

    // Click the limit, edit it, save.
    fireEvent.click(await screen.findByRole('button', { name: '/ 10' }));
    fireEvent.change(screen.getByLabelText('max requests'), {
      target: { value: '25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The editor closes and the new limit is on screen right away.
    expect(await screen.findByRole('button', { name: '/ 25' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant-1/quota',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ max_requests: 25, window_seconds: 30 }),
      }),
    );
  });

  it('rejects a non-positive limit without calling the API', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) =>
      String(input).includes('/stats')
        ? jsonResponse(initialStats)
        : jsonResponse([tenant]),
    ) as jest.Mock;

    render(<Dashboard />);

    fireEvent.click(await screen.findByRole('button', { name: '/ 10' }));
    fireEvent.change(screen.getByLabelText('max requests'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('limit must be a positive integer'),
    ).toBeTruthy();
    const putCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([, init]) => init?.method === 'PUT',
    );
    expect(putCalls).toHaveLength(0);
  });
});
