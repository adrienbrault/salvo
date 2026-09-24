import type { Game } from '../app/Game';

let current: Game | null = null;

export const bindGame = (g: Game): void => {
  current = g;
};

/** The app controller. Bound in main.tsx before any screen that needs it can be shown. */
export function game(): Game {
  if (!current) throw new Error('Game controller not bound yet');
  return current;
}
