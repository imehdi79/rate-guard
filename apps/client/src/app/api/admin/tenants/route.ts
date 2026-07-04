import { proxyAdminGet } from '../../../../lib/admin-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return proxyAdminGet('/api/admin/tenants');
}
