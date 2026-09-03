/**
 * Shared frontmatter shapes for Payload-synced blog posts.
 *
 * Payload is loose about what it writes: images arrive as a plain path, an
 * absolute URL or a media object; draft can be a boolean or the string "true";
 * categories/tags sometimes come through as numbers (years). Anything Zod
 * rejects here drops the post from the collection entirely, so every one of
 * those shapes is accepted and normalised instead.
 */
import { z } from 'astro:content';

/** `/media/x.jpg`, `https://…`, or `{ url, filename, alt }`. */
export const imageField = z
  .union([
    z.string(),
    z
      .object({
        url: z.string().optional(),
        alt: z.string().optional(),
        filename: z.string().optional(),
        prefix: z.string().optional(),
      })
      .passthrough(),
  ])
  .optional();

/** Payload writes booleans, WordPress exports write "true"/"false". */
export const draftField = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === 'true');

/** Present only on some tenants; anything but "published" is unpublished. */
export const statusField = z.string().optional();

/** Payload can emit years as numbers — coerce every entry to a string. */
export const stringListField = z
  .union([z.array(z.union([z.string(), z.number()])), z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return [] as string[];
    const list = Array.isArray(value) ? value : [value];
    return list.map((item) => String(item).trim()).filter(Boolean);
  });
