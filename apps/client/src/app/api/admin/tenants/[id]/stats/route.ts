import { proxyAdminGet } from '../../../../../../lib/admin-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyAdminGet(`/api/admin/tenants/${encodeURIComponent(id)}/stats`);
}
