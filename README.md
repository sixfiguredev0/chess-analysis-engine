# Chess Analysis Engine

A Manifest V3 browser extension that reads a chess position from a live board in the
DOM, evaluates it with an engine, and renders the result as a board overlay plus an
analysis panel. Board readers exist for both **chess.com** and **lichess.org**.

Built as a layered, testable architecture rather than one large content script:
detection → board modelling → engine → move-selection policy → presentation.

Version 4.7.0.

---

## Fair play and scope

**This is an analysis and training tool. It is not an engine-assistance tool for live play.**

The extension operates in exactly two kinds of context:

- **chess.com "Play Computer" games** — unrated games against a bot (path `/play/computer`)
- **Analysis and study boards** on chess.com and lichess.org (paths matching `/analysis` or `/study`)

Outside those, which includes **every live game against a human opponent**, the extension
is completely inert. It does not read the board, does not call the engine, does not draw
an overlay and does not execute moves.

That restriction is not a setting, and it is not a promise in a README. It is enforced in
one predicate, `isSupportedContext()` in `content.js`, and it is checked at the top of the
scan loop before any board access happens. Anyone can verify it by reading the source:

```js
// content.js — checked before the board is ever read
if (!isSupportedContext()) {
  clearArrow();
  removePanel();
  ...
  return;
}
```

The reasoning is worth stating plainly: showing a player the engine's best move during a
rated game is cheating whether or not the software moves the piece for them. Automation is
not the line — engine assistance is. So the tool is scoped to study, training and games
against computer opponents.

Not affiliated with, endorsed by, or connected to Chess.com or Lichess. Use is subject to
those sites' terms of service.

---

## How it works

| File | Responsibility |
| --- | --- |
| `content.js` | Board detection, DOM → position model, scan loop, overlay rendering, move execution |
| `app.js` | Composition root: wires the controllers and publishes the app services |
| `appSettings.js` | Settings model, persisted in `chrome.storage.local` |
| `engineController.js` | Engine request lifecycle, stale-response handling, candidate normalisation |
| `moveSelectionPolicy.js` | Pluggable move-selection strategies |
| `autoMoveController.js` | Analysis → selection → execution state machine |
| `boardAdapter.js` | Adapter decoupling the controller from the platform DOM |
| `background.js` | Service worker: engine backend calls, in-flight de-duplication, caching |
| `popup.html` / `popup.js` / `popup.css` | Popup UI |
| `content.css` | In-page overlay styling |

### Design notes

**Layered, not monolithic.** The content script owns detection and presentation. It holds
no move-selection logic. Policies are separate classes with a single `select()` method, and
the controller talks to the platform through `boardAdapter` rather than to the DOM directly.
Adding a new selection strategy means adding one class, not editing the scan loop.

**Board modelling.** `getBoard()` resolves the board element for either site (`wc-chess-board`
on chess.com, `cg-board` on lichess) and derives orientation from ancestor classes and the
board's flipped state. Piece classes are mapped to roles, and a FEN string is assembled with
castling rights inferred from piece placement. Turn is inferred from the difference between
successive piece maps, which is more reliable than parsing either site's move list.

**Selection policies** are pluggable, and the class of strategy is the interesting part:

- `BestMovePolicy` — the engine's top-ranked move.
- `ImperfectMovePolicy` — picks randomly from the runner-up candidates on a randomised
  schedule, to model weaker play.
- `BoundedRegretPolicy` — picks only among alternatives whose evaluation is within a bounded
  centipawn loss of the best move. This is decision theory applied to search: cap the regret,
  randomise inside the cap. Useful for replaying a position at a chosen strength.

**Stale-response safety.** Every engine request carries a monotonic id. A result whose
position has since changed is discarded rather than acted on, so a slow engine response can
never be applied to the wrong board.

**Execution is verified, not assumed.** Before dispatching a move the board is re-read and
the FEN compared; the move is dispatched only if the position is unchanged and it is still
our turn. After the synthetic pointer sequence the board is read a third time — if the FEN
has not changed, the move was rejected and the failure is surfaced instead of being reported
as a success.

**Timing under control.** Think time is a clamped, ordered, randomised window (`minDelay` →
`maxDelay`), applied before execution rather than between raw events.

**Request de-duplication.** In-flight engine requests are keyed by `elo|fen` and shared, with
a 120-second cache and an LRU bound of 80 entries, so repeated scans of an unchanged position
do not produce repeated network calls.

## Engine backend

Positions are POSTed to `https://chess-api.com/v1`, a free community engine endpoint that
needs no key. Target rating is mapped to search depth (800–2400 → depth 8–18), and
`variants: 5` is requested so the policy layer has multiple candidate lines to choose from.
Pointing this at a different backend means changing one function in `background.js`.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `enabled` | `false` | Master switch |
| `elo` | `1800` | Target rating; drives engine depth |
| `autoplay` | `false` | Execute the selected move, not just display it |
| `showArrow` / `showPanel` | `true` | Overlay presentation |
| `minDelay` / `maxDelay` | 300 / 4000 ms | Randomised think-time window |
| `imperfectMoves` | `false` | Enable weak-move simulation |
| `minWeakInterval` / `maxWeakInterval` | 8 / 20 | Moves between simulated weak moves |

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this directory.
3. Open a supported board (chess.com `/play/computer` or an `/analysis` board) and enable the
   extension from its popup.

Requires a Chromium-based browser with Manifest V3. Firefox would need a manifest shim.

## Limitations

- Board reading is DOM scraping, so it is coupled to those sites' markup. A front-end redesign
  on either site can break detection, and selectors will need updating.
- Turn inference and castling-right derivation are heuristics; unusual positions are worth
  double-checking against the site's own FEN.
- The engine backend is a third-party free service, so latency and rate limits are outside this
  project's control.
- No automated test suite yet. The layered structure exists partly to make one cheap to add.

## Licence

MIT — see [LICENSE](LICENSE).
