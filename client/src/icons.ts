/** 아이콘 (lucide, ISC 라이선스). 필요한 것만 가져와서 번들이 작다 */
import {
  createElement, type IconNode, CircleHelp, Plus, Copy, LockKeyhole,
  UtensilsCrossed, Citrus, Rainbow, Link2, Flag, Thermometer, Hourglass, BatteryCharging, Flame, Sunset,
  Hammer, Crosshair, Pickaxe, Umbrella, Wind, Shield, EyeOff, HandCoins, Swords,
  GlassWater, Dices, Axe, MoveUp, Droplet, Bomb, Target, Skull,
  Sparkles, Crown, Pause, Settings, RefreshCw, Gamepad2, Layers, Gauge, PartyPopper, Zap, Coffee,
  Wifi, Bot, TrendingUp, TrendingDown, Trophy, Coins, Hand, Magnet, LifeBuoy,
  Lock, ShieldCheck, CircleOff, ChevronsUp, Paintbrush, CloudRain, CircleDot, Timer, Undo2,
  Landmark, Ticket, ArrowLeftRight, Repeat, Gift, Palette, Snail, Tornado, Maximize2, CircleDollarSign,
  Rocket, FlipVertical2, Siren, Dog, Footprints, Activity, HandMetal, Castle, Radiation, Medal, Sunrise, PackageSearch, Gem,
  Heart, HandHelping, RotateCcw, FastForward, ShieldOff, Link, Focus, FlameKindling, Sword, Megaphone, Scale, BookOpen, LogOut, X, Construction, SlidersHorizontal, BrickWall, RotateCw, Snowflake, CircleDashed, CloudFog,
  ChevronLeft, ChevronRight, User, Users, HeartPulse, Dumbbell, Clover, Orbit, BatteryFull, ShieldPlus, Sprout,
} from 'lucide';
import type { AbilityCategory, AbilityId, ComboId, CoopItemId, CoopSpecialId, EventId, ItemId, PatternId } from '@color-burst/shared';

/** 스페셜 어택 전용 도형. 대기실과 전투 게이지에서 같은 아이콘을 쓴다. */
const SPECIAL_PATH: Record<CoopSpecialId, string> = {
  laser: '<circle cx="10" cy="24" r="6"/><path d="M16 24h26M20 17h18M20 31h18M35 10l3 4M35 38l3-4"/>',
  meteor: '<circle cx="29" cy="30" r="10"/><path d="M8 6l17 14M5 16l14 12M19 5l14 15M26 32l4-5"/>',
  ward: '<circle cx="24" cy="24" r="19"/><circle cx="24" cy="24" r="15"/><path d="M24 13l9 16H15zM24 35l9-16H15z"/>',
  bind: '<path d="M16 13h-5a6 6 0 0 0 0 12h7m14-2h5a6 6 0 0 0 0-12h-7M14 20l6-6m8 10 6-6M24 24v13m-5-5 5 5 5-5"/><circle cx="24" cy="16" r="4"/>',
  link: '<path d="M9 32 24 17l15 15M9 23 24 8l15 15M9 41l15-15 15 15"/>',
  blades: '<circle cx="24" cy="24" r="4"/><path d="M24 20C12 20 10 9 20 5l4 15ZM28 24c0-12 11-14 15-4l-15 4ZM24 28c12 0 14 11 4 15l-4-15ZM20 24C20 36 9 38 5 28l15-4Z"/>',
};
export const coopSpecialIcon = (id: CoopSpecialId, size = 24) => `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SPECIAL_PATH[id]}</svg>`;

const ABILITY_ICON: Record<AbilityId, IconNode> = {
  picky: UtensilsCrossed, yellowTaste: Citrus, rainbowHunt: Rainbow, comboArtist: Link2, headStart: Flag,
  preheat: Thermometer, overtime: Hourglass, overcharge: BatteryCharging, frenzy: Flame, afterglow: Sunset,
  hammer: Hammer, hunter: Crosshair, crusher: Pickaxe,
  insurance: Umbrella, shield: Shield,
  missSave: HandHelping, rebound: RotateCcw, rapid: FastForward, laserProof: ShieldOff,
  centerKing: Focus, ignite: FlameKindling, vanguard: Sword, taunt: Megaphone,
  thickSkin: EyeOff, plunder: HandCoins, counterPro: Swords,
  jackpot: Coins, wideHand: Hand, magnet: Magnet, reflect: Undo2, edge: Maximize2,
  glassCannon: GlassWater, gambler: Dices, berserker: Axe, oneWay: MoveUp,
  vampire: Droplet, timeBomb: Bomb, selfTarget: Target, devilPact: Skull,
  comebackBoost: Rocket, flip: FlipVertical2, focusFire: Siren, hyena: Dog, chaser: Footprints, momentum: Activity,
  allHands: HandMetal, fortress: Castle, chainBlast: Radiation, bossFeast: Medal, lastFlame: Sunrise, itemHunter: PackageSearch,
  precise: Target, treasure: Gift, itemLover: PackageSearch,
  firstFlame: FlameKindling, finisher: Sword, spacing: Maximize2, riposte: Swords, regularCustomer: Gift,
  silence: CircleOff, mirror: Copy, resonance: Activity, huntInstinct: Footprints,
  harvest: Sprout, ember: FlameKindling, goldCollector: CircleDollarSign, synergyLink: Link,
  drill: Dumbbell, crownMark: Crown, luckStack: Clover, autoMagnet: Orbit, autoCharge: BatteryFull, autoGuard: ShieldPlus,
};

const CATEGORY_ICON: Record<AbilityCategory, IconNode> = {
  점수: Sparkles, 피버: Flame, 보스: Crown, 유지: Shield, 견제: Swords, 보조: LifeBuoy, 성장: Sprout, 저주: Skull, 특별: Gem, 유니크: Sparkles,
};

export const ITEM_ICON: Record<ItemId, IconNode> = {
  wideHand: Hand, magnet: Magnet, missGuard: Wind, comboLock: Lock, guard: ShieldCheck, markClear: CircleOff,
  feverCharge: BatteryCharging, instantFever: Flame, goldHand: HandCoins, double: ChevronsUp, paint: Paintbrush,
  rain: CloudRain, zone: CircleDot, bomb: Bomb, timeStop: Timer, fieldClear: Sparkles,
  slowCursor: Snail, invertCursor: ArrowLeftRight, blind: EyeOff, snipe: Crosshair,
};

/** 협력전 보스전 아이템 */
export const COOP_ITEM_ICON: Record<CoopItemId, IconNode> = {
  clear: Sparkles, guard: ShieldCheck, heal: Heart, healAll: HeartPulse, fire: Flame, power: Sword,
  weak: Crosshair, chain: Radiation, combo: Link2, missile: Rocket,
};

export const EVENT_ICON: Record<EventId, IconNode> = {
  robinHood: HandCoins, tax: Landmark, lottery: Ticket, swap: ArrowLeftRight, abilitySwap: Repeat,
  demote: TrendingDown, gift: Gift, curseDelivery: Skull, theme: Palette, equality: Scale,
};

export const UI = {
  gold: CircleDollarSign, plus: Plus, copy: Copy, lock: LockKeyhole,
  boss: Crown, rainbow: Rainbow, item: Gift, laser: Zap, map: Construction, speed: Gauge, mark: Target, miss: CircleOff, score: Trophy,
  pause: Pause, settings: Settings, reroll: RefreshCw, classic: Gamepad2, arcade: Layers,
  basic: Gauge, party: PartyPopper, hardcore: Zap, chill: Coffee, chaos: Tornado, ping: Wifi, bot: Bot,
  up: TrendingUp, down: TrendingDown, trophy: Trophy, fever: Flame, event: Dices, tax: Landmark,
  codex: BookOpen, leave: LogOut, close: X, special: Gem, combo: Link, guide: CircleHelp,
  obstacle: Construction, precision: Crosshair, custom: SlidersHorizontal,
  prev: ChevronLeft, next: ChevronRight, timer: Timer, solo: User, team: Users, survival: HeartPulse, coop: HandHelping, expert: Skull, heart: Heart,
} as const;

/** 아이콘 SVG 문자열 */
export function icon(node: IconNode, size = 18, cls = '') {
  const el = createElement(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  if (cls) el.classList.add(...cls.split(' '));
  return el.outerHTML;
}

export const comboIcon = (id: ComboId, size = 18) => icon(id === 'bazaar' ? Gift : UI.combo, size);
export const abilityIcon = (id: AbilityId, size = 18, cls = '') => icon(ABILITY_ICON[id] ?? CircleHelp, size, cls);
export const categoryIcon = (c: AbilityCategory, size = 14) => icon(CATEGORY_ICON[c], size);
export const itemIcon = (id: ItemId, size = 18, cls = '') => icon(ITEM_ICON[id], size, cls);
export const coopItemIcon = (id: CoopItemId, size = 18, cls = '') => icon(COOP_ITEM_ICON[id], size, cls);
export const eventIcon = (id: EventId, size = 18, cls = '') => icon(EVENT_ICON[id], size, cls);
const PATTERN_ICON: Record<PatternId, IconNode> = { walls: BrickWall, spikes: Bomb, bar: RotateCw, vortex: Tornado, ice: Snowflake, ring: CircleDashed, fog: CloudFog };
export const patternIcon = (id: PatternId, size = 18, cls = '') => icon(PATTERN_ICON[id], size, cls);
