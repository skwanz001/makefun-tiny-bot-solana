// DipRide: a dual-leg swing bot for hourly Solana bars, long only, one symbol at a time.
//
// How it beats buy-and-hold: buy-and-hold rides every drawdown. DipRide instead buys only
// after a sharp move has already turned, and it leaves quickly when the move fails, so in a
// falling market it sits mostly in USDC, while in a rising market it rides the same symbols
// buy-and-hold holds.
//
// CORE leg (full slice): the 18h return is below -3% (a sharp dip) or above +3% (momentum)
//   and the last 2h return has turned positive, i.e. the move has started to bounce or to run.
//   Exit at +4% take-profit, -4% stop-loss, or when the 2h return turns below -1.5%.
// SCALP leg (half slice): when the symbol has no core signal, a 3h dip below -1.2% while the
//   6h return is not positive is bought small and exited at +1.8% / -1.8% or on a 2h reversal.
//   It keeps the bot trading in quiet, flat windows; its half size bounds what it can lose.
//
// Sizing is an equal equity slice per symbol, capped by the weight cap and the cash on hand.
// Every decision uses only closes the bot has already been sent. Deterministic: no clock,
// no randomness, no environment, no network, standard library only (node:readline via the
// vendored shim). Orders fill at the next bar's open, so signals are always one bar behind
// the close they were decided on, exactly as the replay grades them.
import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const LOOK = 18;
const DIP = 0.03;
const MOM = 0.03;
const BOUNCE = 2;
const TAKE = 0.04;
const STOP = 0.04;
const REV = 0.015;
const SCALP_DIP = 0.012;
const SCALP_TP = 0.018;
const SCALP_SL = 0.018;
const MAX_SLIP = 100;

const closes = new Map<string, number[]>();
/** 'core' | 'scalp' per held symbol, so each leg exits at its own levels. */
const kind = new Map<string, 'core' | 'scalp'>();

function ret(hist: number[], n: number): number | null {
  if (hist.length <= n) return null;
  const now = hist[hist.length - 1];
  const then = hist[hist.length - 1 - n];
  if (then <= 0) return null;
  return now / then - 1;
}

function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }): boolean {
  const value = state.value(symbol, held.qty);
  if (value === 0n || held.cost === 0n) return false;
  const ratio = Number(value) / Number(held.cost);
  const k = kind.get(symbol) ?? 'core';
  const take = k === 'core' ? TAKE : SCALP_TP;
  const stop = k === 'core' ? STOP : SCALP_SL;
  if (ratio >= 1 + take) return true;
  if (ratio <= 1 - stop) return true;
  const hist = closes.get(symbol)!;
  const r = ret(hist, BOUNCE);
  if (r !== null && r <= -REV) return true;
  return false;
}

await runBars({
  onBatch(state, batch) {
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      let hist = closes.get(bar.symbol);
      if (hist === undefined) { hist = []; closes.set(bar.symbol, hist); }
      hist.push(Number(bar.c));
      if (hist.length > 64) hist.shift();
      fresh.add(bar.symbol);
    }
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    // A sell queued last batch may have been refused at its fill, so the position is
    // still held: only forget a leg when the position is actually gone, never when
    // merely queueing its sell (otherwise a refused sell would reset a scalp leg to
    // core exit levels on the next check).
    for (const symbol of [...kind.keys()]) if (!state.positions.has(symbol)) kind.delete(symbol);
    const sells: SellInput[] = [];
    const coreEntries: string[] = [];
    const scalpEntries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const held = state.positions.get(symbol);
      const hist = closes.get(symbol)!;
      if (held !== undefined) {
        if (exits(state, symbol, held)) sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIP });
        continue;
      }
      const rLook = ret(hist, LOOK);
      const rBounce = ret(hist, BOUNCE);
      if (rLook === null || rBounce === null) continue;
      if ((rLook <= -DIP || rLook >= MOM) && rBounce > 0) { coreEntries.push(symbol); continue; }
      const r3 = ret(hist, 3);
      const r6 = ret(hist, 6);
      if (r3 !== null && r6 !== null && r3 <= -SCALP_DIP && r6 <= 0) scalpEntries.push(symbol);
    }
    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    const buy = (symbol: string, size: bigint, k: 'core' | 'scalp'): void => {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) return;
      let slice = size < byWeight ? size : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIP });
      kind.set(symbol, k);
      cash -= slice;
      room--;
    };
    for (const symbol of coreEntries) buy(symbol, stake, 'core');
    for (const symbol of scalpEntries) buy(symbol, stake / 2n, 'scalp');
    return orders;
  },
});
