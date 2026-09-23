/** Starting ships (Balatro decks): a preset weapon + engine + core. */
export interface ChassisDef {
  id: string;
  name: string;
  tagline: string;
  weapon: string;
  engine: string;
  core: string;
  /** Hull tint used by the renderer (hex). */
  color: string;
  accent: string;
}

export const CHASSIS: ChassisDef[] = [
  {
    id: 'faucon',
    name: 'Faucon',
    tagline: 'Tir continu et Salve en éventail. Le classique, pour apprendre.',
    weapon: 'w_blaster',
    engine: 'e_std',
    core: 'c_stable',
    color: '#3a7bff',
    accent: '#4de8ff',
  },
  {
    id: 'luciole',
    name: 'Luciole',
    tagline: 'Ne tire pas. Frôle les balles pour charger une Onde dévastatrice.',
    weapon: 'w_grazer',
    engine: 'e_micro',
    core: 'c_stable',
    color: '#f5a623',
    accent: '#ffd166',
  },
  {
    id: 'prisme',
    name: 'Prisme',
    tagline: 'Absorbe les balles avec ton bouclier, puis renvoie tout.',
    weapon: 'w_mirror',
    engine: 'e_std',
    core: 'c_armored',
    color: '#9aa4ff',
    accent: '#e8e8ff',
  },
  {
    id: 'taureau',
    name: 'Taureau',
    tagline: 'Fonce dans le tas. Tes ruées pulvérisent tout sur leur passage.',
    weapon: 'w_ram',
    engine: 'e_turbo',
    core: 'c_armored',
    color: '#ff3b5c',
    accent: '#ff9f43',
  },
];

export const getChassis = (id: string): ChassisDef => CHASSIS.find((c) => c.id === id) ?? CHASSIS[0]!;
