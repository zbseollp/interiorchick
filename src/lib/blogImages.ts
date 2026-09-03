/**
 * Featured/hero image resolution for blog entries.
 *
 * Payload may put the image on any of featuredImage / heroImage / image, as a
 * string or as a media object, or omit it entirely — in which case we fall back
 * to the first image in the post body. A null result means "render no <img>".
 */
import { resolveMediaUrl, toAbsoluteUrl } from './media-url.mjs';

/** Optional site-wide placeholder; null keeps cards image-less instead of broken. */
export const DEFAULT_BLOG_IMAGE: string | null = null;

type ImageLike = unknown;

export interface BlogImageData {
  featuredImage?: ImageLike;
  heroImage?: ImageLike;
  image?: ImageLike;
  ogImage?: ImageLike;
  featuredImageAlt?: string;
  imageAlt?: string;
  alt?: string;
  title?: string;
  extra?: { featuredImage?: ImageLike; heroImage?: ImageLike };
  meta?: { image?: ImageLike };
}

function readEnv(): Record<string, string | undefined> {
  const viteEnv =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as unknown as Record<string, string | undefined>)
      : undefined;
  const nodeEnv =
    typeof process !== 'undefined' && process.env
      ? (process.env as Record<string, string | undefined>)
      : undefined;
  return { ...nodeEnv, ...viteEnv };
}

/** First markdown or HTML image in a post body, if there is one. */
export function firstBodyImage(body?: string): string | null {
  if (!body) return null;
  const markdown = body.match(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/);
  if (markdown?.[1]) return markdown[1];
  const html = body.match(/<img\b[^>]*?\bsrc=["']([^"']+)["']/i);
  return html?.[1] ?? null;
}

/**
 * Resolve the card/hero image for a post. Empty strings and blank media
 * objects count as missing, so an empty featuredImage never yields a broken
 * <img> — it falls through to the next candidate, then to the body image.
 */
export function resolveFeaturedImage(
  data: BlogImageData | undefined,
  body?: string,
  options: { fallback?: string | null; siteOrigin?: string } = {},
): string | null {
  const fallback = options.fallback === undefined ? DEFAULT_BLOG_IMAGE : options.fallback;
  const env = readEnv();

  const candidates: ImageLike[] = [
    data?.featuredImage,
    data?.heroImage,
    data?.image,
    data?.extra?.featuredImage,
    data?.extra?.heroImage,
    data?.meta?.image,
    firstBodyImage(body),
  ];

  for (const candidate of candidates) {
    const resolved = resolveMediaUrl(candidate, {
      env,
      fallback: null,
      siteOrigin: options.siteOrigin,
    });
    if (resolved) return resolved;
  }

  return fallback ? resolveMediaUrl(fallback, { env, fallback, siteOrigin: options.siteOrigin }) : null;
}

/** Absolute image URL for og:image / JSON-LD. */
export function resolveOgImage(
  data: BlogImageData | undefined,
  body: string | undefined,
  siteOrigin: string,
  options: { fallback?: string | null } = {},
): string | null {
  const primary = resolveMediaUrl(data?.ogImage, { env: readEnv(), fallback: null });
  const image = primary ?? resolveFeaturedImage(data, body, options);
  return toAbsoluteUrl(image, siteOrigin);
}

/** `alt` carried inside a Payload media object, when there is one. */
function mediaObjectAlt(value: ImageLike): string {
  if (!value || typeof value !== 'object') return '';
  const alt = (value as { alt?: unknown }).alt;
  return typeof alt === 'string' ? alt.trim() : '';
}

export function resolveFeaturedImageAlt(data: BlogImageData | undefined, fallback = ''): string {
  return (
    data?.featuredImageAlt?.trim() ||
    data?.imageAlt?.trim() ||
    data?.alt?.trim() ||
    mediaObjectAlt(data?.featuredImage) ||
    mediaObjectAlt(data?.heroImage) ||
    mediaObjectAlt(data?.image) ||
    fallback ||
    data?.title?.trim() ||
    ''
  );
}
