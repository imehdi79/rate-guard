import axios from 'axios';

/**
 * The API contract must be browsable without reading code: Swagger UI at
 * /docs, OpenAPI document at /docs-json, both public (no tenant/admin key).
 */
describe('API docs (e2e)', () => {
  it('serves the Swagger UI at /docs without any key', async () => {
    const res = await axios.get('/docs', { validateStatus: () => true });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.data).toContain('swagger-ui');
  });

  it('documents every endpoint and both api key schemes', async () => {
    const res = await axios.get('/docs-json', { validateStatus: () => true });

    expect(res.status).toBe(200);
    expect(Object.keys(res.data.paths).sort()).toEqual([
      '/api',
      '/api/admin/tenants',
      '/api/admin/tenants/{id}/quota',
      '/api/admin/tenants/{id}/stats',
      '/api/health',
    ]);
    expect(Object.keys(res.data.components.securitySchemes).sort()).toEqual([
      'admin-key',
      'api-key',
    ]);

    // DTO decorators made it into the schema — including the warning that
    // the tenant api key is only ever returned on create.
    const apiKeyField =
      res.data.components.schemas.CreatedTenantDto.properties.api_key;
    expect(apiKeyField.description).toContain('exactly once');

    // The rate-limited endpoint documents its 429 contract.
    const denied = res.data.paths['/api'].get.responses['429'];
    expect(Object.keys(denied.headers).sort()).toEqual([
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ]);
  });
});
