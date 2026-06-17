import { describe, it, expect } from 'vitest';
import { AppError, ValidationError, NotFoundError, ScraperError, NotificationError } from './index';

describe('AppError', () => {
  it('defaults to a 500 operational error named after the class', () => {
    const e = new AppError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.statusCode).toBe(500);
    expect(e.code).toBe('AppError');
    expect(e.isOperational).toBe(true);
    expect(e.name).toBe('AppError');
  });
});

describe('subclasses map to the right status + code', () => {
  it('NotFoundError → 404 NOT_FOUND', () => {
    const e = new NotFoundError();
    expect(e).toBeInstanceOf(AppError);
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('Not found');
  });

  it('ValidationError → 400 VALIDATION_ERROR and carries details', () => {
    const e = new ValidationError('bad', [{ path: 'email' }]);
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.details).toEqual([{ path: 'email' }]);
  });

  it('ScraperError → 502 SCRAPER_ERROR with storeSlug', () => {
    const e = new ScraperError('timeout', { storeSlug: 'amazon', cause: new Error('ETIMEDOUT') });
    expect(e.statusCode).toBe(502);
    expect(e.code).toBe('SCRAPER_ERROR');
    expect(e.storeSlug).toBe('amazon');
  });

  it('NotificationError → 502 NOTIFICATION_ERROR with channel', () => {
    const e = new NotificationError('email failed', { channel: 'email' });
    expect(e.statusCode).toBe(502);
    expect(e.code).toBe('NOTIFICATION_ERROR');
    expect(e.channel).toBe('email');
  });
});
