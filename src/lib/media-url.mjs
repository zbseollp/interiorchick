/**
 * Shared media URL helpers for Astro (build/browser) and Node scripts.
 *
 * Payload writes featured images as `/media/<file>` (or as a media object, or
 * as a bare R2 bucket-root URL). None of those resolve on the deployed site:
 * the objects actually live at `{R2_PUBLIC_URL}/tenants/{slug}/{filename}`.
 * Everything that renders an image goes through resolveMediaUrl().
 */

/** Matches astropayload.config.json tenantSlug for this site. */
export const DEFAULT_TENANT_SLUG = 'interiorchick';

/** Public R2 bucket used by the Payload tenant media store. */
export const DEFAULT_PAYLOAD_PUBLIC_BASE =
  'https://pub-d4024ad3e57841448e0ee58a19abe46b.r2.dev';

/** Site paths that are served from public/ and must stay root-relative. */
const LOCAL_PATH_PREFIXES = [
  '/images/',
  '/assets/',
  '/wp-content/',
  // WordPress upload path. Several tenants serve these straight from public/,
  // so it must NOT be rewritten to R2 — doing so 404s every migrated image.
  '/uploads/',
  '/_astro/',
  '/favicon',
  '/fonts/',
];

/** Media paths Payload owns — these must be rewritten to the R2 base. */
const PAYLOAD_PATH_PREFIXES = ['/media/', '/api/media/'];

function envBag(env) {
  if (env) return env;
  const fromVite =
    typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
  const fromNode = typeof process !== 'undefined' && process.env ? process.env : undefined;
  return { ...fromNode, ...fromVite };
}

/** @returns {string} media host without a trailing slash */
export function getPayloadPublicBase(env) {
  const e = envBag(env);
  const raw =
    e?.R2_PUBLIC_URL ||
    e?.PUBLIC_R2_URL ||
    e?.PUBLIC_PAYLOAD_URL ||
    e?.PUBLIC_PAYLOAD_MEDIA_URL ||
    e?.PAYLOAD_URL ||
    e?.PUBLIC_MEDIA_URL ||
    e?.MEDIA_BASE_URL ||
    DEFAULT_PAYLOAD_PUBLIC_BASE;
  return String(raw).trim().replace(/\/+$/, '');
}

/** @returns {string} tenant slug used in the R2 object key */
export function getTenantSlug(env) {
  const e = envBag(env);
  const raw =
    e?.PUBLIC_TENANT_SLUG || e?.TENANT_SLUG || e?.PAYLOAD_TENANT_SLUG || e?.TENANT || DEFAULT_TENANT_SLUG;
  return String(raw || DEFAULT_TENANT_SLUG)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function isR2Host(hostname) {
  const host = hostname.toLowerCase();
  return host.includes('r2.dev') || host.endsWith('.cloudflarestorage.com');
}

/**
 * Payload's storage-s3 adapter sometimes emits bucket-root URLs
 * (…r2.dev/photo.jpg) while the object lives under tenants/<slug>/.
 * Repair those; leave every already-prefixed or non-R2 URL alone.
 *
 * @param {string} url
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {string}
 */
export function repairTenantR2Url(url, options = {}) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return url;

  try {
    const u = new URL(url);
    if (!isR2Host(u.hostname)) return url;

    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return url;
    if (segments[0] === 'tenants') return url;

    // Bare object at the bucket root. Payload's uploads keep their extension
    // most of the time but not always (…r2.dev/pexels05646 is a real object at
    // …/tenants/<slug>/pexels05646), so do not require one.
    if (segments.length === 1) {
      u.pathname = `/tenants/${getTenantSlug(options.env)}/${segments[0]}`;
      return u.toString();
    }
    // Payload also writes /media/<file> onto the bucket host
    if (segments.length === 2 && segments[0] === 'media') {
      u.pathname = `/tenants/${getTenantSlug(options.env)}/${segments[1]}`;
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Pull a usable URL string out of whatever Payload put in the field:
 * a string, a media object ({url, filename, prefix, sizes}), or a nested value.
 * Returns null for missing/blank so callers can skip rendering an <img>.
 *
 * @param {unknown} input
 * @returns {string | null}
 */
export function extractMediaPath(input) {
  if (!input) return null;

  if (typeof input === 'string') {
    // WordPress exports store `path "Title"` in a single scalar (sometimes with
    // the inner quotes backslash-escaped) — keep just the path.
    const trimmed = input.trim().replace(/\s+\\?["'].*$/, '').trim();
    return trimmed || null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = extractMediaPath(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof input !== 'object') return null;

  const obj = /** @type {Record<string, unknown>} */ (input);
  const filename = typeof obj.filename === 'string' ? obj.filename.trim() : '';
  const prefix = typeof obj.prefix === 'string' ? obj.prefix.trim().replace(/^\/+|\/+$/g, '') : '';
  const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';

  // Rebuild from prefix + filename when the stored URL lost tenants/<slug>/
  if (filename && prefix) {
    if (rawUrl && /^https?:\/\//i.test(rawUrl) && !rawUrl.includes(`/${prefix}/`)) {
      try {
        const u = new URL(rawUrl);
        u.pathname = `/${prefix}/${filename}`;
        return u.toString();
      } catch {
        /* fall through to the plain URL below */
      }
    }
    if (rawUrl) return rawUrl;
    return `/${prefix}/${filename}`;
  }

  if (rawUrl) return rawUrl;
  if (typeof obj.src === 'string' && obj.src.trim()) return obj.src.trim();
  if (filename) return `/media/${filename}`;

  if (obj.value && typeof obj.value === 'object') return extractMediaPath(obj.value);

  if (obj.sizes && typeof obj.sizes === 'object') {
    const sizes = /** @type {Record<string, unknown>} */ (obj.sizes);
    for (const key of ['hero', 'featured', 'og', 'large', 'medium', 'thumbnail']) {
      const found = extractMediaPath(sizes[key]);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Turn any Payload media value into a URL the browser can actually load.
 * Returns `fallback` (null by default) when there is nothing to render —
 * callers must not emit an <img> for a null result.
 *
 * @param {unknown} input
 * @param {{
 *   env?: Record<string, string | undefined>;
 *   fallback?: string | null;
 *   siteOrigin?: string;
 * }} [options]
 * @returns {string | null}
 */
export function resolveMediaUrl(input, options = {}) {
  const { env, fallback = null, siteOrigin } = options;
  const raw = extractMediaPath(input);
  if (!raw) return fallback;

  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (/^https?:\/\//i.test(raw)) return repairTenantR2Url(raw, { env });
  if (raw.startsWith('//')) return repairTenantR2Url(`https:${raw}`, { env });

  const path = raw.startsWith('/') ? raw : `/${raw}`;

  // Served from public/ — keep same-origin, absolutize only for OG tags.
  if (LOCAL_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return siteOrigin ? new URL(path, siteOrigin).href : path;
  }

  // Payload-owned media → {base}/tenants/{slug}/{filename}
  if (PAYLOAD_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    const filename = path.split('/').filter(Boolean).pop();
    if (!filename) return fallback;
    return `${getPayloadPublicBase(env)}/tenants/${getTenantSlug(env)}/${filename}`;
  }

  return siteOrigin ? new URL(path, siteOrigin).href : path;
}

/** Make a resolved URL absolute for Open Graph / JSON-LD. */
export function toAbsoluteUrl(url, siteOrigin) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (!siteOrigin) return url;
  return new URL(url, siteOrigin).href;
}

/**
 * Rewrite every <img src>/srcset in a raw HTML body through resolveMediaUrl,
 * for tenants that render post bodies with set:html.
 *
 * @param {string} html
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {string}
 */
export function repairMediaUrlsInHtml(html, options = {}) {
  if (!html || typeof html !== 'string') return html;

  const rewriteList = (value) =>
    value
      .split(',')
      .map((candidate) => {
        const [url, ...descriptors] = candidate.trim().split(/\s+/);
        if (!url) return candidate.trim();
        const resolved = resolveMediaUrl(url, { ...options, fallback: url });
        return [resolved, ...descriptors].join(' ');
      })
      .join(', ');

  // Match whole <img> tags first, then every source attribute inside each one —
  // a single pass over the attributes would only ever rewrite the first.
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(
      /\b(src|srcset|data-src|data-srcset)=(["'])(.*?)\2/gi,
      (attr, name, quote, value) => `${name}=${quote}${rewriteList(value)}${quote}`,
    ),
  );
}
