import { describe, it, expect } from 'vitest';
import { normalizeHostname, detectStore, slugify, extractMetadata, nameFromUrl, type StoreLike } from './importUrl';

const STORES: StoreLike[] = [
  { id: '1', slug: 'amazon', name: 'Amazon', domain: 'amazon.com' },
  { id: '2', slug: 'playstation', name: 'PlayStation Direct', domain: 'direct.playstation.com' },
  { id: '3', slug: 'bestbuy', name: 'Best Buy', domain: 'bestbuy.com' },
];

describe('normalizeHostname', () => {
  it('strips www and lowercases', () => {
    expect(normalizeHostname('https://www.Amazon.com/dp/B0')).toBe('amazon.com');
    expect(normalizeHostname('https://direct.playstation.com/x')).toBe('direct.playstation.com');
  });
  it('rejects non-http(s) and garbage', () => {
    expect(normalizeHostname('ftp://x.com')).toBeNull();
    expect(normalizeHostname('not a url')).toBeNull();
  });
});

describe('detectStore', () => {
  it('matches exact host and subdomains', () => {
    expect(detectStore('https://www.amazon.com/dp/B0', STORES)?.slug).toBe('amazon');
    expect(detectStore('https://smile.amazon.com/dp/B0', STORES)?.slug).toBe('amazon');
    expect(detectStore('https://direct.playstation.com/en-us/p/x', STORES)?.slug).toBe('playstation');
  });
  it('returns null for unknown retailers', () => {
    expect(detectStore('https://www.randomshop.io/p/1', STORES)).toBeNull();
    expect(detectStore('garbage', STORES)).toBeNull();
  });
});

describe('slugify', () => {
  it('slugifies names and trims punctuation', () => {
    expect(slugify('Sony WH-1000XM5!')).toBe('sony-wh-1000xm5');
    expect(slugify('  spaced  out  ')).toBe('spaced-out');
  });
  it('falls back to "item" for empty input and caps length', () => {
    expect(slugify('   ')).toBe('item');
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('extractMetadata', () => {
  it('prefers og tags, then falls back to <title>', () => {
    const og = '<html><head><meta property="og:title" content="Cool Gadget"><meta property="og:image" content="https://x/i.jpg"></head></html>';
    expect(extractMetadata(og)).toEqual({ name: 'Cool Gadget', image: 'https://x/i.jpg' });
    const titleOnly = '<html><head><title>Just A Title</title></head></html>';
    expect(extractMetadata(titleOnly).name).toBe('Just A Title');
  });
  it('returns empty when nothing is present', () => {
    expect(extractMetadata('<html></html>')).toEqual({ name: undefined, image: undefined });
  });
});

describe('nameFromUrl', () => {
  it('derives a readable name from the last path segment', () => {
    expect(nameFromUrl('https://x.com/p/cool-gadget-123')).toBe('cool gadget 123');
    expect(nameFromUrl('https://x.com/')).toBe('x.com');
  });
});
