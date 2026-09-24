/** Hull points as hexagonal pips. `key` it on `hp` to replay the bump when it changes. */
export function HpPips({ hp, max, class: cls = '' }: { hp: number; max: number; class?: string }) {
  const pips = [];
  for (let i = 0; i < max; i++) pips.push(<i key={i} class={i < hp ? 'on' : ''} />);
  return (
    <span class={`hp-pips ${hp <= 1 ? 'low' : ''} ${cls}`} role="img" aria-label={`${hp} of ${max} HP`}>
      {pips}
    </span>
  );
}
