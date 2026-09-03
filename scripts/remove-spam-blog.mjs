#!/usr/bin/env node
/**
 * Delete hard-spam posts (injected scripts, redirect payloads) from the blog
 * collection, and REPORT off-topic gossip filler without touching it.
 *
 * Deliberately not spam: <iframe>/<script src> embeds (YouTube players, social
 * widgets) and images on a third-party CDN. Both appear in real articles;
 * treating them as injection deletes legitimate posts.
 *
 *   node scripts/remove-spam-blog.mjs                 delete hard spam, report off-topic
 *   node scripts/remove-spam-blog.mjs --dry-run       report only, delete nothing
 *   node scripts/remove-spam-blog.mjs --apply-offtopic also delete the reported off-topic posts
 *
 * Off-topic removal is opt-in because "is this on topic" is an editorial call:
 * auto-deleting it would 404 live, indexed URLs.
 */
import { unlinkSync } from 'node:fs';
import { BLOG_DIR, exists, listBlogFiles, readField, readPost } from './lib/blog-files.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const applyOffTopic = args.has('--apply-offtopic');

const INJECTION_PATTERNS = [
  /document\s*\.\s*write\s*\(/i,
  /\beval\s*\(\s*atob\s*\(/i,
  /\bunescape\s*\(\s*["']%(?:3C|64)/i,
  /window\s*\.\s*location\s*(?:\.\s*(?:href|replace)\s*[=(]|\s*=)/i,
  /<meta[^>]+http-equiv=["']?refresh["']?[^>]*url=/i,
];
const OFF_TOPIC_TITLE_PATTERNS = [
  /\bvriendin\b/i,
  /\bvriend van\b/i,
  /\bgetrouwd\b/i,
  /\brelatiestatus\b/i,
  /\bex-partner\b/i,
  /\bzwanger\b/i,
  /\b(?:vermogen|lengte|leeftijd) van\b/i,
];

if (!exists(BLOG_DIR)) {
  console.log(`[remove-spam-blog] no ${BLOG_DIR}/ — nothing to do`);
  process.exit(0);
}

const spam = [];
const offTopic = [];

for (const path of listBlogFiles()) {
  const post = readPost(path);
  const title = readField(post.frontmatter, 'title') ?? '';
  const haystack = `${post.slug}\n${title}\n${post.body}`;

  if (INJECTION_PATTERNS.some((p) => p.test(haystack))) {
    spam.push({ path, title, reason: 'injected script/redirect payload' });
    continue;
  }
  if (OFF_TOPIC_TITLE_PATTERNS.some((p) => p.test(`${post.slug.replace(/-/g, ' ')} ${title}`))) {
    offTopic.push({ path, title });
  }
}

for (const entry of spam) {
  if (dryRun) console.log(`[remove-spam-blog] would delete ${entry.path} (${entry.reason})`);
  else {
    unlinkSync(entry.path);
    console.log(`[remove-spam-blog] deleted ${entry.path} (${entry.reason})`);
  }
}

if (offTopic.length > 0) {
  console.log(
    `[remove-spam-blog] ${offTopic.length} off-topic candidate(s) — review, then rerun with --apply-offtopic to remove:`,
  );
  for (const entry of offTopic) console.log(`  · ${entry.path} — ${entry.title}`);
  if (applyOffTopic && !dryRun) {
    for (const entry of offTopic) {
      unlinkSync(entry.path);
      console.log(`[remove-spam-blog] deleted ${entry.path} (off-topic)`);
    }
  }
}

console.log(
  `[remove-spam-blog] ${spam.length} hard spam, ${offTopic.length} off-topic candidate(s)${dryRun ? ' (dry run)' : ''}`,
);
