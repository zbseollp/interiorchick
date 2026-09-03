#!/usr/bin/env node
/**
 * Non-destructive cleanup pass over synced blog content:
 *  - strip inline <script> blocks carrying injection payloads (embed scripts
 *    with a src are left alone — they are ordinary article content)
 *  - blank image fields whose value is not an image at all (a bare page URL),
 *    which would otherwise render as a broken <img>
 *  - normalise WordPress `path "Title"` image scalars down to the path
 *  - repair bare R2 bucket-root URLs to tenants/<slug>/<file>
 *  - blank out empty-string image fields so they read as "no image"
 *  - turn hybrid <br /><br />## Heading into Markdown blank-line headings
 */
import { writeFileSync } from 'node:fs';
import { resolveMediaUrl } from '../src/lib/media-url.mjs';
import { BLOG_DIR, exists, listBlogFiles, readPost } from './lib/blog-files.mjs';

const IMAGE_FIELDS = ['featuredImage', 'heroImage', 'image', 'ogImage'];

/**
 * A featured image must point at an actual file. Payload/WordPress sometimes
 * stores a site URL ("https://example.com/nl/") in the image field; rendering
 * that as an <img> yields a broken image on every card.
 */
function looksLikeImage(value) {
  if (!value) return false;
  if (value.startsWith('data:image/')) return true;
  // Payload media, with or without an extension: its R2 objects are not always
  // named with one (…r2.dev/pexels05646 is a real image).
  if (/^\/(?:media|api\/media)\//i.test(value)) return true;
  if (/^https?:\/\/[^/]*(?:r2\.dev|cloudflarestorage\.com)\//i.test(value)) return true;
  const withoutQuery = value.split(/[?#]/)[0];
  return /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i.test(withoutQuery);
}

/** Quote only values YAML would otherwise misread; plain URLs stay unquoted. */
function needsQuoting(value) {
  return /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || /:\s/.test(value) || /\s#/.test(value);
}

/** Rewrite bare bucket-root R2 URLs to tenants/<slug>/<file>. */
function normalizeImageValue(value) {
  if (!value) return '';
  const repaired = resolveMediaUrl(value, { fallback: null });
  return repaired || value;
}

/**
 * Payload hybrids use <br /><br />## Heading — turn those into blank lines so
 * Markdown parsing (and human editors) see real headings.
 */
function normalizeHybridMarkdown(body) {
  return body
    .replace(/\s*<br\s*\/?>\s*<br\s*\/?>\s*(#{1,6}\s+)/gi, '\n\n$1')
    .replace(/\s*<br\s*\/?>\s*(#{1,6}\s+)/gi, '\n\n$1')
    .replace(/(#{1,6}\s+[^\n<]+)\s*<br\s*\/?>\s*/gi, '$1\n\n')
    // Leftover single <br> right after a heading blank line.
    .replace(/(^|\n)(#{1,6}\s+[^\n]+)\n+\s*<br\s*\/?>\s*/gi, '$1$2\n\n');
}

if (!exists(BLOG_DIR)) {
  console.log(`[sanitize-blog] no ${BLOG_DIR}/ — nothing to do`);
  process.exit(0);
}

let changed = 0;

for (const path of listBlogFiles()) {
  const post = readPost(path);
  if (!post.hasFrontmatter) continue;

  let frontmatter = post.frontmatter;
  let body = post.body;

  for (const field of IMAGE_FIELDS) {
    frontmatter = frontmatter.replace(
      // Capture the rest of the line plus whatever follows, so a nested media
      // object (value on the following indented lines) can be left untouched.
      new RegExp(`^(${field}:[ \\t]*)([^\\n]*)(\\n|$)([ \\t]+\\S)?`, 'gm'),
      (match, head, rawValue, newline, nextIndented) => {
        const value = rawValue.trim();

        // `featuredImage:` followed by an indented line is a Payload media
        // object — a legitimate shape the schema handles. Never flatten it.
        if (!value && nextIndented) return match;
        if (!value) return `${head}""${newline}${nextIndented ?? ''}`;

        const unquoted = value.replace(/^["']|["']$/g, '');
        // `path "Title"` → path (the quotes may arrive backslash-escaped),
        // before deciding whether the value is an image at all
        const stripped = unquoted.replace(/\s+\\?["'].*$/, '').trim();
        const normalized = normalizeImageValue(stripped);

        // Nothing to correct: keep the line byte-for-byte, so a tenant that
        // quotes its frontmatter is not reformatted on every build.
        if (stripped === unquoted && looksLikeImage(stripped) && normalized === stripped) {
          return match;
        }

        const next = !normalized || !looksLikeImage(normalized)
          ? `${head}""`
          : needsQuoting(normalized)
            ? `${head}"${normalized}"`
            : `${head}${normalized}`;
        return `${next}${newline}${nextIndented ?? ''}`;
      },
    );
  }

  // Strip only inline scripts carrying an injection payload. Embed scripts
  // with a src (YouTube, social widgets) are ordinary article content.
  body = body
    .replace(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, (block) =>
      /document\s*\.\s*write\s*\(|eval\s*\(\s*atob\s*\(|window\s*\.\s*location/i.test(block)
        ? ''
        : block,
    )
    .replace(/^.*document\s*\.\s*write\s*\([\s\S]*?\).*$/gim, '');

  body = normalizeHybridMarkdown(body);

  const next = `---\n${frontmatter}\n---\n${body}`;
  if (next !== post.raw) {
    writeFileSync(path, next);
    changed += 1;
  }
}

console.log(`[sanitize-blog] sanitized ${changed} file(s)`);
