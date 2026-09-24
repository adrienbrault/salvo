import { type MarkKind, parseMarkup } from '../markup';

const CLASS: Record<MarkKind, string> = {
  m: 'mk-m',
  b: 'mk-b',
  x: 'mk-x',
  $: 'mk-money',
  k: 'mk-k',
  g: 'mk-g',
};

/** Renders item description markup as colored spans. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseMarkup(text).map((s, i) =>
        s.kind === 'text' ? (
          s.text
        ) : (
          <span key={i} class={CLASS[s.kind]}>
            {s.text}
          </span>
        ),
      )}
    </>
  );
}
