import { describe, it, expect } from 'vitest';
import { BaseScraper, type StockResult } from './base';

// Minimal concrete subclass to exercise the protected isBotBlocked() heuristic.
class TestScraper extends BaseScraper {
  async checkStock(): Promise<StockResult> {
    return { storeSlug: 'test', status: 'UNKNOWN', productUrl: 'https://example.com' };
  }
  detect(html: string): boolean {
    return (this as unknown as { isBotBlocked(h: string): boolean }).isBotBlocked(html);
  }
}

const scraper = new TestScraper('test');

// ~3.5k chars of innocuous visible product copy — comfortably over the 2000-char
// "this is a real page" threshold.
const longText = 'This is a perfectly normal product page describing a wonderful item. '.repeat(60);

describe('isBotBlocked', () => {
  it('flags an empty / tiny shell (under the min length)', () => {
    expect(scraper.detect('<html><body></body></html>')).toBe(true);
  });

  it('flags a challenge page by <title>, even when padded with script', () => {
    const html =
      `<html><head><title>Just a moment...</title></head>` +
      `<body><p>Checking…</p><script>${'x'.repeat(2000)}</script></body></html>`;
    expect(scraper.detect(html)).toBe(true);
  });

  it('flags a tiny page carrying a bot-challenge text marker', () => {
    const html =
      `<html><head><title>Security</title></head>` +
      `<body><p>Please verify you are a human to continue.</p>` +
      `<script>${'y'.repeat(2000)}</script></body></html>`;
    expect(scraper.detect(html)).toBe(true);
  });

  it('does NOT flag a large, normal product page', () => {
    const html =
      `<html><head><title>Cool Gadget — Buy Now</title></head>` +
      `<body><main>${longText}</main></body></html>`;
    expect(scraper.detect(html)).toBe(false);
  });

  it('does NOT flag a large page that merely mentions a marker phrase', () => {
    // The documented false-positive trap: a real page that happens to contain
    // "checking your browser" somewhere in lots of legitimate content.
    const html =
      `<html><head><title>Cool Gadget</title></head>` +
      `<body><main>${longText} checking your browser ${longText}</main></body></html>`;
    expect(scraper.detect(html)).toBe(false);
  });
});
