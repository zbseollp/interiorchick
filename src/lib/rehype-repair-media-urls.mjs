/**
 * Rehype plugin: rewrite every <img> in rendered Markdown/MDX bodies through
 * resolveMediaUrl, so Payload's /media/... and bare-R2 sources resolve.
 * Registered in astro.config.mjs → markdown.rehypePlugins.
 */
import { resolveMediaUrl } from './media-url.mjs';

function visit(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}

function repairSrcSet(value) {
  return value
    .split(',')
    .map((candidate) => {
      const [url, ...descriptors] = candidate.trim().split(/\s+/);
      if (!url) return candidate.trim();
      return [resolveMediaUrl(url, { fallback: url }), ...descriptors].join(' ');
    })
    .join(', ');
}

export default function rehypeRepairMediaUrls() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'img') return;
      const props = node.properties ?? (node.properties = {});

      if (typeof props.src === 'string') {
        props.src = resolveMediaUrl(props.src, { fallback: props.src });
      }
      if (typeof props.srcSet === 'string') {
        props.srcSet = repairSrcSet(props.srcSet);
      } else if (Array.isArray(props.srcSet)) {
        props.srcSet = props.srcSet.map((entry) =>
          typeof entry === 'string' ? repairSrcSet(entry) : entry,
        );
      }
    });
  };
}
