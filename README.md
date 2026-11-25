# DipRide — Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana

[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/skwanz001/makefun-tiny-bot-solana/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/skwanz001/makefun-tiny-bot-solana/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny paper-trading bot for hourly Solana bars (`agent-fun/bars-replay/v1`) that beats
buy-and-hold. One program, `main.ts`, Node 22, standard library only.

## Strategy

Buy-and-hold rides every drawdown. DipRide buys only after a sharp move has already
turned, and leaves quickly when the move fails, so in a falling market it sits mostly in
USDC, while in a rising market it rides the same symbols buy-and-hold holds.

- **Core leg** (full slice): the 18h return is below −3% (a sharp dip) or above +3%
  (momentum) and the last 2h return has turned positive. Exit at +4% take-profit,
  −4% stop-loss, or a 2h reversal below −1.5%.
- **Scalp leg** (half slice): when a symbol has no core signal, a 3h dip below −1.2%
  while the 6h return is not positive is bought small, exited at +1.8% / −1.8% or on a
  2h reversal. It keeps the bot trading in quiet, flat windows; its half size bounds
  what it can lose.
- Sizing is an equal equity slice per symbol, capped by the weight cap and cash on hand.
- Deterministic: no clock, no randomness, no environment, no network.

## Backtest (kit dev window, 136 hourly bars, 29 Oct – 3 Nov 2026)

Local replay with the kit's exact fill model (fill at next open, 10 bps fee, 5 bps
slippage, constant-product impact):

| | DipRide | Buy-and-hold |
| --- | --- | --- |
| Net PnL | −$393.68 | −$869.34 |
| Return | −3.94% | −8.69% |
| Max drawdown | 5.25% | 10.92% |
| Trades | 92 | 7 |

Margin over buy-and-hold: **+$475.66** on the dev window. Across nine sliding 72-bar
windows (the final window's length) it beats buy-and-hold on 7 of 9, mean margin
+$236, worst −$338, with at least 10 trades per window (guardrail: 8) and max
drawdown under 5.3% everywhere (guardrail: 25%).

## Run

```sh
node main.ts   # speaks agent-fun/bars-replay/v1 on stdin/stdout
```

## License

MIT — see [LICENSE](LICENSE).
