import type { RunState } from '../../run/state';
import type { KillType } from '../../sim/types';
import { killTypeFit } from '../upgrades';

/** Whether the ship makes this kill type: highlighted when it does, a muted warning when not. */
export function KillTypeFitLine({ run, kt }: { run: RunState; kt: KillType }) {
  const fit = killTypeFit(run, kt);
  return <span class={fit.fits ? 'fit fit-ok' : 'fit fit-off'}>{fit.text}</span>;
}
