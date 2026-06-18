import * as cheerio from 'cheerio';

/**
 * Pure helpers for the paste-URL self-import flow (retailer detection, slug
 * generation, page-metadata extraction). No DB or network here — unit-testable.
 */

export interface StoreLike {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
}

/** Lowercased hostname without a leading "www.", or null for a non-http(s) URL. */
export function normalizeHostname(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Match a URL to a known store by domain (exact host or a subdomain of it). */
export function detectStore(rawUrl: string, stores: StoreLike[]): StoreLike | null {
  const host = normalizeHostname(rawUrl);
  if (!host) return null;
  for (const s of stores) {
    if (!s.domain) continue;
    const d = s.domain.toLowerCase().replace(/^www\./, '');
    if (host === d || host.endsWith('.' + d)) return s;
  }
  return null;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80) || 'item'
  );
}

export interface PageMeta {
  name?: string;
  image?: string;
}

/** Pull a product name + image from page metadata (og: / twitter: / <title>). */
export function extractMetadata(html: string): PageMeta {
  const $ = cheerio.load(html);
  const pick = (sel: string, attr = 'content'): string | undefined => {
    const v = $(sel).attr(attr);
    return v && v.trim() ? v.trim() : undefined;
  };
  const name =
    pick('meta[property="og:title"]') ||
    pick('meta[name="twitter:title"]') ||
    ($('title').first().text().trim() || undefined) ||
    ($('h1').first().text().trim() || undefined);
  const image =
    pick('meta[property="og:image"]') ||
    pick('meta[name="twitter:image"]') ||
    pick('link[rel="image_src"]', 'href');
  return { name, image };
}

/** Last-resort name when the page exposes no usable title. */
export function nameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (!seg) return host;
    // Strip a file extension and turn separators into spaces (path segments only —
    // never the hostname, or "x.com" would become "x").
    return (
      decodeURIComponent(seg)
        .replace(/\.[a-z0-9]{1,5}$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim() || host
    );
  } catch {
    return 'Imported product';
  }
}
