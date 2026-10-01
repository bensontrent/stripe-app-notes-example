import Markdoc from '@markdoc/markdoc';
import React from 'react';
import { markdocComponents } from './components';
import { markdocConfig } from './config';

/**
 * Renders a Markdoc document body. Content was already validated against
 * markdocConfig by the content loader (src/services/markdoc/content.ts).
 */
export function DocBody({ source }: { source: string }) {
  if (!source) return null;
  const content = Markdoc.transform(Markdoc.parse(source), markdocConfig);
  return (
    <div className="docs-prose">
      {Markdoc.renderers.react(content, React, { components: markdocComponents })}
    </div>
  );
}
