import { ratesFor, type Profile } from './idle.ts';

/**
 * Bounty tokens: a battle reward worth an hour of idling, banked.
 *
 * These exist because **battling paid almost nothing**. Clearing every stage
 * from 1 to 10 for the first time granted 17,370 xp -- fifty minutes of idling
 * at that stage's rate, against the 1.5 hours it takes to bring five characters
 * to level 10. The entire first playthrough was worth a third of one levelling
 * pass, so the only thing that ever advanced a roster was wall-clock time and
 * the game politely asked you not to play it.
 *
 * A token is not a quantity of gold. It is a quantity of TIME, cashed at the
 * rate you are earning when you spend it.
 */
export type Bounty = 'gold' | 'xp';

export interface ItemDef {
  id: string;
  bounty: Bounty;
  hours: number;
  name: string;
}

/**
 * Six tokens: two currencies, three durations.
 *
 * Named rather than numbered because they are objects a player collects and
 * recognises, and "Full House" is a thing you are pleased to see where
 * `gold_6h` is a row in a table.
 */
export const ITEMS: ItemDef[] = [
  { id: 'xp_1h', bounty: 'xp', hours: 1, name: 'Rehearsal Notes' },
  { id: 'xp_3h', bounty: 'xp', hours: 3, name: 'Prompt Book' },
  { id: 'xp_6h', bounty: 'xp', hours: 6, name: "Director's Cut" },
  { id: 'gold_1h', bounty: 'gold', hours: 1, name: 'Box Office Take' },
  { id: 'gold_3h', bounty: 'gold', hours: 3, name: 'Matinee Receipts' },
  { id: 'gold_6h', bounty: 'gold', hours: 6, name: 'Full House' },
];

export const itemById = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id);

/**
 * What a token pays, at the rate you are earning NOW.
 *
 * Valued on use rather than on drop, which is the whole character of the thing.
 * It means a token banked early and spent late is worth more, so holding one is
 * a decision rather than an oversight -- and it means a reward earned at stage 3
 * does not become worthless by stage 20, which is the failure mode of a flat
 * quantity in a game whose rates climb.
 *
 * The cost is that a hoard grows in value while you do nothing, which is the
 * one thing an idle game is usually careful about. It is bounded here by there
 * being nothing else to spend a token on: banking is the only strategy, so it
 * is not a strategy anyone can get wrong.
 */
export function itemValue(item: ItemDef, stage: number): number {
  const rates = ratesFor(stage);
  const perMin = item.bounty === 'gold' ? rates.goldPerMin : rates.xpPerMin;
  return Math.round(perMin * 60 * item.hours);
}

/** Spend one, if the profile holds it. Returns null when it does not. */
export function useItem(
  profile: Profile,
  id: string,
): { profile: Profile; item: ItemDef; gained: number } | null {
  const item = itemById(id);
  if (!item || (profile.items[id] ?? 0) <= 0) return null;
  const gained = itemValue(item, profile.stage);
  return {
    profile: {
      ...profile,
      items: { ...profile.items, [id]: profile.items[id]! - 1 },
      gold: profile.gold + (item.bounty === 'gold' ? gained : 0),
      xp: profile.xp + (item.bounty === 'xp' ? gained : 0),
    },
    item,
    gained,
  };
}

/**
 * What a first clear drops. **Bosses pay in time; corridor stages pay in gold.**
 *
 * The rule is one sentence because the alternative was not tunable. An xp token
 * on every stage sounds generous and is not a gift: at stage 10 a single
 * 1-hour xp token is **68%** of what it costs to bring five characters to level
 * 10, so a handful of them does not reward battling, it deletes the idle half
 * of the game.
 *
 * The number that settled it is not a ratio but a LEVEL. Clearing stages 1-10
 * banks 17,370 xp on its own, which is five characters at **level 8**, against
 * the **13** stage 10 wants for a comfortable win. Adding:
 *
 *     +1h  -> level 11   short of the gate, and closer to it
 *     +2h  -> level 13   arrives exactly on target, having skipped the wall
 *     +3h  -> level 15   over it
 *     +6h  -> level 18   seven levels past what the act asks for
 *
 * So Act 1 pays **one hour**, and the loop survives: the tokens carry you most
 * of the way and the last two levels still come from idling, which is the
 * "stuck, idle a little, clear it" shape the ladder was built for.
 *
 * `act` is passed in rather than derived, because `BOSS_EVERY` lives in
 * `content.ts` -- which imports the engine, so the engine cannot import it back.
 * The duration climbs with the act because level costs do: 3 hours at stage 20
 * rates is roughly the same fraction of a level-20 roster that 1 hour is of a
 * level-10 one.
 *
 * First clears only. A stage-1 clear takes about thirty seconds, so a token on
 * every repeat would make farming the shortest fight in the game strictly
 * better than playing it -- roughly 20,700 xp a minute at stage-10 rates. The
 * high-water mark closes that at the source rather than with a cooldown.
 */
export function dropsFor(stage: number, boss: boolean, act = 1): string[] {
  // Gold has nowhere to go yet -- there is no shop -- so it is safe to hand out
  // freely, and it means every clear drops SOMETHING.
  if (!boss) return ['gold_1h'];
  const xp = act <= 1 ? 'xp_1h' : act === 2 ? 'xp_3h' : 'xp_6h';
  return [xp, 'gold_6h'];
}

/** Add dropped ids to an inventory. */
export function addItems(items: Profile['items'], drops: string[]): Profile['items'] {
  const next = { ...items };
  for (const id of drops) next[id] = (next[id] ?? 0) + 1;
  return next;
}
