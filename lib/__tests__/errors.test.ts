import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  handleApiError,
} from '@/lib/errors';

describe('error classes', () => {
  it('ValidationError maps to HTTP 400', () => {
    const e = new ValidationError('bad input');
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.message).toBe('bad input');
  });

  it('UnauthorizedError maps to HTTP 401', () => {
    expect(new UnauthorizedError().status).toBe(401);
  });

  it('NotFoundError maps to HTTP 404', () => {
    expect(new NotFoundError().status).toBe(404);
  });

  it('ConflictError maps to HTTP 409', () => {
    const e = new ConflictError('linked records exist');
    expect(e.status).toBe(409);
    expect(e.code).toBe('CONFLICT');
  });

  it('AppError defaults to HTTP 500', () => {
    expect(new AppError('boom').status).toBe(500);
  });
});

describe('handleApiError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves the status and message of a known AppError', () => {
    const res = handleApiError(new NotFoundError('Sale not found'));
    expect(res).toEqual({ success: false, error: 'Sale not found', status: 404 });
  });

  it('masks unknown errors as a generic 500 (no leak of internals)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = handleApiError(new Error('connection string with secret'));
    expect(res.status).toBe(500);
    expect(res.error).toBe('Internal server error');
    expect(res.error).not.toContain('secret');
  });
});
