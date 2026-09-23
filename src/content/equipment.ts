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
    desc: 'Tir automatique continu. {k:Action} : Salve de 13 projectiles en éventail (recharge 2,2 s). Kills : {k:Tir}.',
    flavor: 'Fiable. Bruyant. Efficace.',
  },
  {
    id: 'w_grazer',
    kind: 'weapon',
    weapon: 'grazer',
    name: 'Frôleur',
    glyph: '≋',
    color: '#ffd166',
    rarity: 'common',
    price: 7,
    tags: ['graze'],
    desc: 'Aucun tir. Chaque {k:frôlement} charge l’Onde et lâche une étincelle chercheuse. {k:Action} : libère l’{k:Onde}, qui annule les balles. Kills : {k:Onde}.',
    flavor: 'Plus tu t’approches, plus tu frappes fort.',
  },
  {
    id: 'w_mirror',
    kind: 'weapon',
    weapon: 'mirror',
    name: 'Miroir',
    glyph: '◈',
    color: '#e8e8ff',
    rarity: 'common',
    price: 7,
    tags: ['reflect'],
    desc: 'Aucun tir. {k:Maintiens l’action} : bouclier qui absorbe les balles (te ralentit). {k:Relâche} : renvoie tout. Kills : {k:Renvoi}.',
    flavor: 'Leurs balles. Ton problème ? Non : le leur.',
  },
  {
    id: 'w_ram',
    kind: 'weapon',
    weapon: 'ram',
    name: 'Bélier',
    glyph: '⟫',
    color: '#ff5d73',
    rarity: 'common',
    price: 7,
    tags: ['impact'],
    desc: 'Aucun tir. {k:Action} : ruée invulnérable qui pulvérise balles et ennemis (2 charges). Kills : {k:Impact}.',
    flavor: 'La meilleure défense, c’est la vitesse.',
  },
];

export const ENGINE_ITEMS: ItemDef[] = [
  {
    id: 'e_std',
    kind: 'engine',
    name: 'Propulseur',
    glyph: '⊙',
    color: '#9ad1ff',
    rarity: 'common',
    price: 5,
    desc: 'Vitesse, hitbox et frôlement standards.',
  },
  {
    id: 'e_micro',
    kind: 'engine',
    name: 'Micro-réacteur',
    glyph: '∘',
    color: '#b8f2a0',
    rarity: 'common',
    price: 5,
    tags: ['graze'],
    desc: 'Hitbox {k:−30%}, rayon de frôlement {k:+30%}, vitesse {k:−12%}.',
    modifyStats(s) {
      s.hitRadius *= 0.7;
      s.grazeRadius *= 1.3;
      s.speed *= 0.88;
    },
  },
  {
    id: 'e_turbo',
    kind: 'engine',
    name: 'Postcombustion',
    glyph: '⋙',
    color: '#ff9f43',
    rarity: 'common',
    price: 5,
    tags: ['impact'],
    desc: 'Vitesse {k:+30%}, hitbox {k:+20%}, rayon de frôlement {k:−15%}.',
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
    name: 'Cœur stable',
    glyph: '◆',
    color: '#7cf29a',
    rarity: 'common',
    price: 6,
    desc: '{k:3 PV} max.',
  },
  {
    id: 'c_armored',
    kind: 'core',
    name: 'Cœur blindé',
    glyph: '⬟',
    color: '#a0a8c0',
    rarity: 'common',
    price: 6,
    tags: ['defense'],
    desc: '{k:5 PV} max. Récompense de niveau {$:−$1}.',
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
    name: 'Cœur instable',
    glyph: '✶',
    color: '#ff4f9a',
    rarity: 'common',
    price: 6,
    tags: ['risk'],
    desc: '{k:2 PV} max. Tous les gains de jauge {m:Mult} {x:×2}.',
    modifyStats(s) {
      s.maxHp -= 1;
      s.gaugeGainMul *= 2;
    },
  },
  {
    id: 'c_merchant',
    kind: 'core',
    name: 'Cœur marchand',
    glyph: '¤',
    color: '#ffd23f',
    rarity: 'common',
    price: 6,
    tags: ['economy'],
    desc: '{k:3 PV} max. Plafond d’intérêts {$:+$3}, relances {$:−$1}.',
    modifyEconomy(e) {
      e.interestCap += 3;
      e.rerollBase -= 1;
    },
  },
];
