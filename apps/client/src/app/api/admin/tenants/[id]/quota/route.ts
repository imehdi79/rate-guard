import { proxyAdminPut } from '../../../../../../lib/admin-api';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyAdminPut(
    `/api/admin/tenants/${encodeURIComponent(id)}/quota`,
    await req.text(),
  );
}
