/** Shared helpers for the scripts/*-blog.mjs content passes. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const BLOG_DIR = 'src/content/blog';

export function listBlogFiles(dir = BLOG_DIR) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listBlogFiles(path));
    else if (/\.mdx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

export function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: raw, hasFrontmatter: false };
  return {
    frontmatter: match[1],
    body: raw.slice(match[0].length),
    hasFrontmatter: true,
  };
}

export function readField(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '') || null;
}

export function slugOf(path) {
  return path.split('/').pop().replace(/\.mdx?$/, '');
}

export function readPost(path) {
  const raw = readFileSync(path, 'utf8');
  const { frontmatter, body, hasFrontmatter } = splitFrontmatter(raw);
  return { path, raw, frontmatter, body, hasFrontmatter, slug: slugOf(path) };
}

export function exists(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
