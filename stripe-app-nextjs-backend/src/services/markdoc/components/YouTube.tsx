/**
 * `{% youtube id="..." title="..." /%}` — privacy-enhanced, lazy-loaded
 * YouTube embed in a 16:9 frame.
 */
export function YouTube({ id, title, start }: { id: string; title?: string; start?: number }) {
  return (
    <div className="my-6 aspect-video w-full max-w-2xl overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`}
        title={title ?? 'Video'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        className="h-full w-full"
      />
    </div>
  );
}
