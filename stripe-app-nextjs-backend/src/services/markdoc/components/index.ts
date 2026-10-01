import { Callout } from './Callout';
import { MdImage } from './MdImage';
import { Step, Steps } from './Steps';
import { YouTube } from './YouTube';

/**
 * React components for the Markdoc render names declared in
 * src/services/markdoc/config.ts. Passed to Markdoc.renderers.react in
 * DocBody.
 */
export const markdocComponents = {
  MdImage,
  YouTube,
  Callout,
  Steps,
  Step,
};
