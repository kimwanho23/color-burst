/** 아이콘 (lucide, ISC 라이선스). 필요한 것만 가져와서 번들이 작다 */
import {
  createElement, type IconNode, CircleHelp,
  UtensilsCrossed, Citrus, Rainbow, Link2, Flag, Thermometer, Hourglass, BatteryCharging, Flame, Sunset,
  Hammer, Crosshair, Pickaxe, Umbrella, Wind, Shield, EyeOff, HandCoins, Swords, RadioTower,
  GlassWater, Dices, Axe, MoveUp, Droplet, Bomb, Target, Skull,
  Sparkles, Crown, Pause, Settings, RefreshCw, Gamepad2, Layers, Gauge, PartyPopper, Zap, Coffee,
  Wifi, Bot, TrendingUp, TrendingDown, Trophy, Coins, Hand, Magnet, LifeBuoy,
  Lock, ShieldCheck, CircleOff, ChevronsUp, Paintbrush, CloudRain, CircleDot, Timer, Undo2,
  Landmark, Ticket, ArrowLeftRight, Repeat, Gift, Palette, Snail, Tornado, Maximize2, CircleDollarSign,
  Rocket, FlipVertical2, Siren, Dog, Footprints, Activity, HandMetal, Castle, Radiation, Medal, Sunrise, PackageSearch, Gem,
  Heart, HandHelping, RotateCcw, FastForward, ShieldOff, Archive, Link, Focus, FlameKindling, Sword, Megaphone, Scale, BookOpen, LogOut, X, Construction, SlidersHorizontal, BrickWall, RotateCw, Snowflake, CircleDashed, CloudFog,
  ChevronLeft, ChevronRight, User, Users, HeartPulse, Dumbbell, Clover, Orbit, BatteryFull, ShieldPlus, Sprout,
} from 'lucide';
import type { AbilityCategory, AbilityId, EventId, ItemId, PatternId } from '@color-burst/shared';

const ABILITY_ICON: Record<AbilityId, IconNode> = {
  picky: UtensilsCrossed, yellowTaste: Citrus, rainbowHunt: Rainbow, comboArtist: Link2, headStart: Flag,
  preheat: Thermometer, overtime: Hourglass, overcharge: BatteryCharging, frenzy: Flame, afterglow: Sunset,
  hammer: Hammer, hunter: Crosshair, crusher: Pickaxe,
  insurance: Umbrella, shield: Shield,
  missSave: HandHelping, rebound: RotateCcw, rapid: FastForward, laserProof: ShieldOff, collector: Archive,
  chainCombo: Link, centerKing: Focus, ignite: FlameKindling, vanguard: Sword, taunt: Megaphone,
  thickSkin: EyeOff, plunder: HandCoins, counterPro: Swords, jammer: RadioTower,
  jackpot: Coins, wideHand: Hand, magnet: Magnet, reflect: Undo2, edge: Maximize2,
  glassCannon: GlassWater, gambler: Dices, berserker: Axe, oneWay: MoveUp,
  vampire: Droplet, timeBomb: Bomb, selfTarget: Target, devilPact: Skull,
  comebackBoost: Rocket, flip: FlipVertical2, focusFire: Siren, hyena: Dog, chaser: Footprints, momentum: Activity,
  allHands: HandMetal, fortress: Castle, chainBlast: Radiation, bossFeast: Medal, lastFlame: Sunrise, itemHunter: PackageSearch,
  drill: Dumbbell, crownMark: Crown, luckStack: Clover, autoMagnet: Orbit, autoCharge: BatteryFull, autoGuard: ShieldPlus,
};

const CATEGORY_ICON: Record<AbilityCategory, IconNode> = {
  점수: Sparkles, 피버: Flame, 보스: Crown, 유지: Shield, 견제: Swords, 보조: LifeBuoy, 성장: Sprout, 저주: Skull, 특별: Gem,
};

export const ITEM_ICON: Record<ItemId, IconNode> = {
  wideHand: Hand, magnet: Magnet, missGuard: Wind, comboLock: Lock, guard: ShieldCheck, markClear: CircleOff,
  feverCharge: BatteryCharging, instantFever: Flame, goldHand: HandCoins, double: ChevronsUp, paint: Paintbrush,
  rain: CloudRain, zone: CircleDot, bomb: Bomb, timeStop: Timer, fieldClear: Sparkles,
  slowCursor: Snail, invertCursor: ArrowLeftRight, blind: EyeOff, snipe: Crosshair,
};

export const EVENT_ICON: Record<EventId, IconNode> = {
  robinHood: HandCoins, tax: Landmark, lottery: Ticket, swap: ArrowLeftRight, abilitySwap: Repeat,
  demote: TrendingDown, gift: Gift, curseDelivery: Skull, theme: Palette, equality: Scale,
};

export const UI = {
  gold: CircleDollarSign,
  pause: Pause, settings: Settings, reroll: RefreshCw, classic: Gamepad2, arcade: Layers,
  basic: Gauge, party: PartyPopper, hardcore: Zap, chill: Coffee, chaos: Tornado, ping: Wifi, bot: Bot,
  up: TrendingUp, down: TrendingDown, trophy: Trophy, fever: Flame, event: Dices, tax: Landmark,
  codex: BookOpen, leave: LogOut, close: X, special: Gem, combo: Link, guide: CircleHelp,
  obstacle: Construction, precision: Crosshair, custom: SlidersHorizontal,
  prev: ChevronLeft, next: ChevronRight, timer: Timer, solo: User, team: Users, survival: HeartPulse, coop: HandHelping, heart: Heart,
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

export const abilityIcon = (id: AbilityId, size = 18, cls = '') => icon(ABILITY_ICON[id], size, cls);
export const categoryIcon = (c: AbilityCategory, size = 14) => icon(CATEGORY_ICON[c], size);
export const itemIcon = (id: ItemId, size = 18, cls = '') => icon(ITEM_ICON[id], size, cls);
export const eventIcon = (id: EventId, size = 18, cls = '') => icon(EVENT_ICON[id], size, cls);
const PATTERN_ICON: Record<PatternId, IconNode> = { walls: BrickWall, spikes: Bomb, bar: RotateCw, vortex: Tornado, ice: Snowflake, ring: CircleDashed, fog: CloudFog };
export const patternIcon = (id: PatternId, size = 18, cls = '') => icon(PATTERN_ICON[id], size, cls);
