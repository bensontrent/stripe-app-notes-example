/**
 * Render target for the `{% image %}` tag. Plain `![alt](src)` markdown
 * images render through Markdoc's default img node; reach for the tag when
 * you need to constrain the display width:
 * `{% image src="/globe.svg" alt="..." width=200 /%}`
 *
 * A plain <img> (not next/image) keeps the sample dependency-free of image
 * sizing — docs images live in /public and are served as-is.
 */
export function MdImage({
  src,
  alt,
  title,
  width,
}: {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? ''}
      title={title}
      style={width ? { width } : undefined}
      className="my-6 h-auto max-w-full rounded-xl border border-black/10 dark:border-white/15"
    />
  );
}
