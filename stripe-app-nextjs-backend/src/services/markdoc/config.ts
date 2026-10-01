import Markdoc, { type Config, type Node, Tag } from '@markdoc/markdoc';

/**
 * Markdoc schema for the /docs pages — the single source of truth shared by
 * build-time validation (src/services/markdoc/content.ts) and rendering
 * (DocBody). Tags render to the React components registered in
 * src/services/markdoc/components.
 */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-');
}

/** Plain text of a node's inline children (for heading ids). */
function textContent(node: Node): string {
  let text = '';
  for (const child of node.walk()) {
    if (child.type === 'text' && typeof child.attributes.content === 'string') {
      text += child.attributes.content;
    }
  }
  return text;
}

export type DocHeading = { id: string; title: string; level: number };

/**
 * The h2/h3 headings of a Markdoc document, with the same slug ids the
 * heading transform assigns — powers the "On this page" rail.
 */
export function extractHeadings(source: string): DocHeading[] {
  const headings: DocHeading[] = [];
  for (const node of Markdoc.parse(source).walk()) {
    if (node.type !== 'heading') continue;
    const level = Number(node.attributes.level);
    if (level < 2 || level > 3) continue;
    const title = textContent(node);
    if (title) headings.push({ id: slugify(title), title, level });
  }
  return headings;
}

export const markdocConfig: Config = {
  nodes: {
    // The doc page already wraps DocBody in its own <article>, so the
    // document node renders as bare children instead of Markdoc's default
    // <article> wrapper — which would otherwise sit between .docs-prose and
    // the content and break its direct-child spacing selectors.
    document: { ...Markdoc.nodes.document, render: undefined },
    // Headings get slug ids so docs support anchor deep-links.
    heading: {
      ...Markdoc.nodes.heading,
      transform(node, config) {
        const attributes = node.transformAttributes(config);
        const children = node.transformChildren(config);
        const id = slugify(textContent(node));
        return new Tag(`h${node.attributes.level}`, { ...attributes, id }, children);
      },
    },
  },
  tags: {
    // Explicit image tag for when the markdown `![alt](src)` form isn't
    // enough — currently that means constraining the display width:
    // {% image src="/window.svg" alt="..." width=200 /%}
    image: {
      render: 'MdImage',
      selfClosing: true,
      attributes: {
        src: { type: String, required: true },
        alt: { type: String },
        /** Display width in px (height scales automatically). */
        width: { type: Number },
      },
    },
    youtube: {
      render: 'YouTube',
      selfClosing: true,
      attributes: {
        id: { type: String, required: true },
        title: { type: String },
        /** Start playback at this many seconds in. */
        start: { type: Number },
      },
    },
    callout: {
      render: 'Callout',
      attributes: {
        type: { type: String, default: 'info', matches: ['info', 'warning', 'error'] },
        title: { type: String },
      },
    },
    steps: {
      render: 'Steps',
    },
    step: {
      render: 'Step',
      attributes: {
        title: { type: String, required: true },
      },
    },
  },
};
