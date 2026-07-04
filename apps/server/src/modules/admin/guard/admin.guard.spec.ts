import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let config: { get: jest.Mock };

  const contextFor = (headers: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    config = { get: jest.fn().mockReturnValue('admin-secret') };

    const moduleRef = await Test.createTestingModule({
      providers: [AdminGuard, { provide: ConfigService, useValue: config }],
    }).compile();

    guard = moduleRef.get(AdminGuard);
  });

  it('allows requests presenting the configured admin key', () => {
    const ctx = contextFor({ 'x-admin-key': 'admin-secret' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies a wrong key', () => {
    expect(guard.canActivate(contextFor({ 'x-admin-key': 'nope' }))).toBe(
      false,
    );
  });

  it('denies a missing key', () => {
    expect(guard.canActivate(contextFor({}))).toBe(false);
  });

  it('fails closed when ADMIN_API_KEY is not configured', () => {
    config.get.mockReturnValue(undefined);

    expect(
      guard.canActivate(contextFor({ 'x-admin-key': 'admin-secret' })),
    ).toBe(false);
  });

  it('compares only the first value of a repeated header', () => {
    const ctx = contextFor({ 'x-admin-key': ['nope', 'admin-secret'] });

    expect(guard.canActivate(ctx)).toBe(false);
  });
});
