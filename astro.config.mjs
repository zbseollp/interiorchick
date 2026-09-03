// @ts-check
import { defineConfig } from 'astro/config';
import rehypeRepairMediaUrls from './src/lib/rehype-repair-media-urls.mjs';
import mdx from '@astrojs/mdx';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig({
  vite: { envPrefix: ['PUBLIC_', 'R2_', 'TENANT', 'PAYLOAD_'] },
  // Rewrites /media/... and bare-R2 <img> sources in post bodies.
  markdown: { rehypePlugins: [rehypeRepairMediaUrls] },
  site: 'https://interiorchick.nl',
  trailingSlash: 'always',
  compressHTML: true,
  integrations: [mdx()],
});
