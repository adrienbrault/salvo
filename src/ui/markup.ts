/**
 * Item description markup (see `ItemDef.desc`): `{m:+3 Mult}` +Mult, `{b:+20 Shards}` base,
 * `{x:×2 Mult}` ×Mult, `{$:$1}` money, `{k:Impact}` keyword, `{g:+0.15}` gauge.
 * Anything malformed stays literal text.
 */
export type MarkKind = 'm' | 'b' | 'x' | '$' | 'k' | 'g';

export type Segment = { kind: 'text'; text: string } | { kind: MarkKind; text: string };

const TAG = /\{([mbx$kg]):([^{}]*)\}/g;

export function parseMarkup(src: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: src.slice(last, at) });
    out.push({ kind: m[1] as MarkKind, text: m[2]! });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

/** Plain text (markup stripped), e.g. for `title` / `aria-label`. */
export const stripMarkup = (src: string): string =>
  parseMarkup(src)
    .map((s) => s.text)
    .join('');
