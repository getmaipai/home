import shots from '../../screenshots.json';

type Entry = { file: string; alt: string; caption: string };

// One screenshot by id. The picture, alt text and caption all come from
// screenshots.json, so a caption is identical on every page that uses it.
export function Shot({ id }: { id: string }) {
  const s = (shots as Record<string, Entry>)[id];
  if (!s) throw new Error(`Unknown screenshot id "${id}". Add it to screenshots.json.`);
  return (
    <figure className="shot">
      <img src={`/screens/${s.file}`} alt={s.alt} loading="lazy" />
      <figcaption>{s.caption}</figcaption>
    </figure>
  );
}
