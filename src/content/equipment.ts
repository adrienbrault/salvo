import type { ItemDef } from './types';

/** Weapons define the action button and the damage source (and thus the kill type). */
export const WEAPON_ITEMS: ItemDef[] = [
  {
    id: 'w_blaster',
    kind: 'weapon',
    weapon: 'blaster',
    name: 'Blaster',
    glyph: '⇈',
    color: '#4de8ff',
    rarity: 'common',
    price: 7,
    tags: ['shots'],
    desc: 'Continuous auto-fire. {k:Action}: a 13-shot fanning Salvo (2.2 s recharge). Kills: {k:Shot}.',
    flavor: 'Reliable. Loud. Effective.',
  },
  {
    id: 'w_grazer',
    kind: 'weapon',
    weapon: 'grazer',
    name: 'Grazer',
    glyph: '≋',
    color: '#ffd166',
    rarity: 'common',
    price: 7,
    tags: ['graze'],
    desc: 'No shots. Each {k:graze} charges the Wave and sheds a homing spark. {k:Action}: unleash the {k:Wave}, which cancels bullets. Kills: {k:Wave}.',
    flavor: 'The closer you get, the harder you hit.',
  },
  {
    id: 'w_mirror',
    kind: 'weapon',
    weapon: 'mirror',
    name: 'Mirror',
    glyph: '◈',
    color: '#e8e8ff',
    rarity: 'common',
    price: 7,
    tags: ['reflect'],
    desc: 'No shots. {k:Hold action}: a shield that absorbs bullets (slows you down). {k:Release}: send it all back. Kills: {k:Reflect}.',
    flavor: 'Their bullets. Your problem? Nope: theirs.',
  },
  {
    id: 'w_ram',
    kind: 'weapon',
    weapon: 'ram',
    name: 'Ram',
    glyph: '⟫',
    color: '#ff5d73',
    rarity: 'common',
    price: 7,
    tags: ['impact'],
    desc: 'No shots. {k:Action}: an invulnerable dash that shreds bullets and enemies (2 charges). Kills: {k:Impact}.',
    flavor: 'The best defense is speed.',
  },
];

export const ENGINE_ITEMS: ItemDef[] = [
  {
    id: 'e_std',
    kind: 'engine',
    name: 'Thruster',
    glyph: '⊙',
    color: '#9ad1ff',
    rarity: 'common',
    price: 5,
    desc: 'Standard speed, hitbox and graze.',
  },
  {
    id: 'e_micro',
    kind: 'engine',
    name: 'Micro-reactor',
    glyph: '∘',
    color: '#b8f2a0',
    rarity: 'common',
    price: 5,
    tags: ['graze'],
    desc: 'Hitbox {k:−30%}, graze radius {k:+30%}, speed {k:−12%}.',
    modifyStats(s) {
      s.hitRadius *= 0.7;
      s.grazeRadius *= 1.3;
      s.speed *= 0.88;
    },
  },
  {
    id: 'e_turbo',
    kind: 'engine',
    name: 'Afterburner',
    glyph: '⋙',
    color: '#ff9f43',
    rarity: 'common',
    price: 5,
    tags: ['impact'],
    desc: 'Speed {k:+30%}, hitbox {k:+20%}, graze radius {k:−15%}.',
    modifyStats(s) {
      s.speed *= 1.3;
      s.hitRadius *= 1.2;
      s.grazeRadius *= 0.85;
    },
  },
];

export const CORE_ITEMS: ItemDef[] = [
  {
    id: 'c_stable',
    kind: 'core',
    name: 'Stable Core',
    glyph: '◆',
    color: '#7cf29a',
    rarity: 'common',
    price: 6,
    desc: '{k:3 HP} max.',
  },
  {
    id: 'c_armored',
    kind: 'core',
    name: 'Armored Core',
    glyph: '⬟',
    color: '#a0a8c0',
    rarity: 'common',
    price: 6,
    tags: ['defense'],
    desc: '{k:5 HP} max. Level reward {$:−$1}.',
    modifyStats(s) {
      s.maxHp += 2;
    },
    modifyEconomy(e) {
      e.levelRewardDelta -= 1;
    },
  },
  {
    id: 'c_unstable',
    kind: 'core',
    name: 'Unstable Core',
    glyph: '✶',
    color: '#ff4f9a',
    rarity: 'common',
    price: 6,
    tags: ['risk'],
    desc: '{k:2 HP} max. All {m:Mult} gauge gains {x:×2}.',
    modifyStats(s) {
      s.maxHp -= 1;
      s.gaugeGainMul *= 2;
    },
  },
  {
    id: 'c_merchant',
    kind: 'core',
    name: 'Merchant Core',
    glyph: '¤',
    color: '#ffd23f',
    rarity: 'common',
    price: 6,
    tags: ['economy'],
    desc: '{k:3 HP} max. Interest cap {$:+$3}, rerolls {$:−$1}.',
    modifyEconomy(e) {
      e.interestCap += 3;
      e.rerollBase -= 1;
    },
  },
];
