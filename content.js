(() => {
  const DEFAULTS = {
    enabled: false,
    elo: 1800,
    showArrow: true,
    showPanel: true,
    turnOverride: "auto",
    autoplay: false,
    minDelay: 300,
    maxDelay: 4000,
    imperfectMoves: false,
    minWeakInterval: 8,
    maxWeakInterval: 20
  };

  const FILES = "abcdefgh";
  const PIECE_CHARS = {wp:"P", wn:"N", wb:"B", wr:"R", wq:"Q", wk:"K", bp:"p", bn:"n", bb:"b", br:"r", bq:"q", bk:"k"};
  const ROLE_MAP = {pawn:"p", knight:"n", bishop:"b", rook:"r", queen:"q", king:"k"};
  const appServices = globalThis.ChessAnalysisApp || {};
  const engineController = appServices.engineController || new EngineController();
  const bestMovePolicy = appServices.bestMovePolicy || new BestMovePolicy([]);
  const imperfectMovePolicy = appServices.imperfectMovePolicy || new ImperfectMovePolicy([]);
  const autoMoveController = appServices.autoMoveController || new AutoMoveController(
    engineController,
    bestMovePolicy,
    imperfectMovePolicy
  );
  const boardAdapter = new BoardAdapter();
  autoMoveController.attachBoardAdapter(boardAdapter);

  const state = {
    ...DEFAULTS,
    site: "",
    board: null,
    orientation: "white",
    lastFen: null,
    currentTurn: null,
    analyzing: false,
    requestId: 0,
    result: null,
    scanTimer: null,
    moveCount: 0,
    nextWeakAt: null,
    selectedDisplayMove: null,
    lastStatusKey: null,
    lastPanelKey: null,
    observedBoard: null,
    boardObserver: null,
    pointerBoundBoard: null,
    scanQueued: false,
    scanInProgress: false,
    lastScanAt: 0,
    previousPieces: null,
    stableFenCandidate: null,
    stableFenSince: 0,
    stableTurn: null,
    dragging: false,
    engineFen: null
  };

  function siteName() {
    if (location.hostname.includes("lichess")) return "Lichess";
    if (location.hostname.includes("chess.com")) return "Chess.com";
    return "Chess site";
  }

  function cls(el) {
    if (!el) return "";
    return typeof el.className === "string" ? el.className : (el.className?.baseVal || "");
  }

  function sendStatus(mode, result) {
    const key = `${mode}|${result || ""}`;
    if (state.lastStatusKey === key) return;
    state.lastStatusKey = key;
    try {
      chrome.runtime.sendMessage({type:"POPUP_STATUS", site:state.site, mode, result});
    } catch (_) {}
  }

  function parentHasClass(el, pattern, depth = 6) {
    let n = el;
    for (let i = 0; n && i < depth; i++, n = n.parentElement) {
      if (pattern.test(cls(n))) return true;
    }
    return false;
  }

  function getBoard() {
    if (location.hostname.includes("lichess")) {
      const b = document.querySelector("cg-board");
      if (b && b.querySelector("piece")) return b;
    }
    if (location.hostname.includes("chess.com")) {
      const b = document.querySelector("wc-chess-board");
      if (b && b.querySelector(".piece")) return b;
    }
    const fallback = document.querySelector(".board, .chessboard");
    return fallback && fallback.querySelector("piece,.piece") ? fallback : null;
  }

  function boardOrientation(board) {
    if (!board) return "white";
    if (parentHasClass(board, /(^|\s)(orientation-black|flipped|is-black)(\s|$)/i)) return "black";
    if (parentHasClass(board, /(^|\s)(orientation-white|is-white)(\s|$)/i)) return "white";
    if (location.hostname.includes("chess.com") && /\bflipped\b/i.test(cls(board))) return "black";
    return state.orientation || "white";
  }

  function squareFromRect(boardRect, x, y, orientation) {
    const col = Math.floor(((x - boardRect.left) / boardRect.width) * 8);
    const row = Math.floor(((y - boardRect.top) / boardRect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const file = orientation === "black" ? 7 - col : col;
    const rank = orientation === "black" ? row + 1 : 8 - row;
    return FILES[file] + rank;
  }

  function squareFromChessComClass(element, _orientation) {
    // Chess.com encodes the logical square directly as square-FR:
    // 11 = a1, 12 = a2, 21 = b1, ..., 88 = h8.
    // Orientation is ONLY for screen placement, not for decoding the piece.
    const c = cls(element);
    const m = c.match(/(?:^|\s)square-([1-8])([1-8])(?:\s|$)/i);
    if (!m) return null;

    const fileIndex = Number(m[1]) - 1;
    const rank = Number(m[2]);
    return FILES[fileIndex] + rank;
  }

  function elementSquare(el, board, orientation) {
    if (location.hostname.includes("chess.com")) {
      const fromClass = squareFromChessComClass(el, orientation);
      if (fromClass) return fromClass;
    }
    const br = board.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!br.width || !br.height || !r.width || !r.height) return null;
    return squareFromRect(br, r.left + r.width / 2, r.top + r.height / 2, orientation);
  }

  function parsePieceClass(el) {
    const c = cls(el).toLowerCase();
    const compact = c.match(/(?:^|\s)([wb][pnbrqk])(?:\s|$)/);
    if (compact?.[1] && PIECE_CHARS[compact[1]]) return compact[1];
    const named = c.match(/(?:^|\s)(white|black)[^\n]*\s(pawn|knight|bishop|rook|queen|king)(?:\s|$)/);
    if (named) return (named[1] === "white" ? "w" : "b") + ROLE_MAP[named[2]];
    const roleMatch = Object.keys(ROLE_MAP).find(r => new RegExp(`(?:^|\\s)${r}(?:\\s|$)`).test(c));
    const color = /(?:^|\s)white(?:\s|$)/.test(c) ? "w" : /(?:^|\s)black(?:\s|$)/.test(c) ? "b" : null;
    return color && roleMatch ? color + ROLE_MAP[roleMatch] : null;
  }

  function readPieces(board, orientation) {
    const out = {};
    const nodes = location.hostname.includes("chess.com") ? board.querySelectorAll(".piece") : board.querySelectorAll("piece");
    for (const el of nodes) {
      const piece = parsePieceClass(el);
      if (!piece) continue;
      const square = elementSquare(el, board, orientation);
      if (square) out[square] = piece;
    }
    return Object.keys(out).length >= 2 ? out : null;
  }

  function boardPart(pieces) {
    let fen = "";
    for (let rank = 8; rank >= 1; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = pieces[FILES[file] + rank];
        if (!p) { empty++; continue; }
        if (empty) { fen += empty; empty = 0; }
        fen += PIECE_CHARS[p];
      }
      if (empty) fen += empty;
      if (rank !== 1) fen += "/";
    }
    return fen;
  }

  function highlightSquares(board, orientation) {
    const selectors = location.hostname.includes("lichess")
      ? ["square.last-move", "square.lastmove"]
      : [".last-move", ".move-highlight"];
    const out = [];
    for (const selector of selectors) {
      for (const el of board.querySelectorAll(selector)) {
        const sq = elementSquare(el, board, orientation);
        if (sq && !out.includes(sq)) out.push(sq);
      }
    }
    return out;
  }

  function movedColorFromHighlights(board, orientation, pieces) {
    const squares = highlightSquares(board, orientation);
    if (squares.length < 2) return null;

    for (const sq of [...squares].reverse()) {
      const piece = pieces[sq];
      if (piece?.[0] === 'w' || piece?.[0] === 'b') return piece[0];
    }
    return null;
  }

  function inferTurnFromPositionDelta(previousPieces, currentPieces) {
    if (!previousPieces || !currentPieces) return null;

    const changedSquares = [];
    for (const file of FILES) {
      for (let rank = 1; rank <= 8; rank++) {
        const sq = `${file}${rank}`;
        if (previousPieces[sq] !== currentPieces[sq]) changedSquares.push(sq);
      }
    }
    if (!changedSquares.length) return null;

    const changedByColor = {w: 0, b: 0};
    for (const sq of changedSquares) {
      const before = previousPieces[sq];
      const after = currentPieces[sq];
      if (before?.[0]) changedByColor[before[0]]++;
      if (after?.[0]) changedByColor[after[0]]++;
    }

    if (changedByColor.w === changedByColor.b) return null;
    return changedByColor.w > changedByColor.b ? 'b' : 'w';
  }

  function activeClockTurn() {
    const candidates = document.querySelectorAll(
      ".rclock.running, .clock.running, .clock-bottom .running, .clock-top .running, " +
      ".clock-component.clock-player-turn, .timer-component.clock-player-turn"
    );
    for (const el of candidates) {
      const all = `${cls(el)} ${cls(el.parentElement)} ${cls(el.parentElement?.parentElement)}`.toLowerCase();
      const label = `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.toLowerCase();
      if (/black/.test(all) || /black.*clock|clock.*black/.test(label)) return "b";
      if (/white/.test(all) || /white.*clock|clock.*white/.test(label)) return "w";
    }
    return null;
  }

  function moveListPly() {
    const selectors = [
      ".analyse__moves .node", ".analyse__moves .move", ".game__moves .node",
      ".moves .node", ".move-list-row", ".move-list-row .node",
      ".move-history .node", ".main-line .node", ".move-text-component"
    ];
    let best = 0;
    for (const selector of selectors) {
      best = Math.max(best, document.querySelectorAll(selector).length);
    }
    return best;
  }

  function detectExplicitTurnFromText() {
    const selectors = [
      '[aria-label*="to move" i]',
      '[data-turn]',
      '[data-color-to-move]',
      '.puzzle-info',
      '.puzzle-feedback',
      '.puzzle-controls'
    ];

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const text = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-turn') || ''} ${el.getAttribute('data-color-to-move') || ''} ${el.textContent || ''}`.toLowerCase();
        if (/black\s+to\s+move|black.*turn/.test(text)) return 'b';
        if (/white\s+to\s+move|white.*turn/.test(text)) return 'w';
      }
    }

    // On Chess.com puzzle pages the UI explicitly states whose turn it is.
    // Restrict the body-text fallback to puzzle pages to avoid matching random
    // references to "black" and "white" elsewhere on normal game pages.
    if (location.hostname.includes('chess.com') && /\/puzzles\//i.test(location.pathname)) {
      const text = (document.body.innerText || '').slice(0, 12000).toLowerCase();
      if (/black\s+to\s+move/.test(text)) return 'b';
      if (/white\s+to\s+move/.test(text)) return 'w';
    }

    return null;
  }

  function detectTurnFromBoardProperties(board) {
    if (!board) return null;

    const candidates = [
      board.getAttribute?.('data-turn'),
      board.getAttribute?.('data-turn-color'),
      board.dataset?.turn,
      board.dataset?.turnColor,
      board.turnColor,
      board.turn,
      board.game?.turn,
      board.game?.turnColor
    ];

    for (const value of candidates) {
      if (value === 'w' || value === 'white') return 'w';
      if (value === 'b' || value === 'black') return 'b';
    }

    return null;
  }

  function detectTurn(board, pieces, orientation) {
    if (state.turnOverride === 'w' || state.turnOverride === 'b') return state.turnOverride;

    // Once a previous position exists, prefer the side inferred from the actual
    // piece delta. This avoids guessing from transient highlights during drags.
    const inferred = inferTurnFromPositionDelta(state.previousPieces, pieces);
    if (inferred) return inferred;

    const direct = detectTurnFromBoardProperties(board);
    if (direct) return direct;

    const explicit = detectExplicitTurnFromText();
    if (explicit) return explicit;

    const movedColor = movedColorFromHighlights(board, orientation, pieces);
    if (movedColor) return movedColor === 'w' ? 'b' : 'w';

    const clock = activeClockTurn();
    if (clock) return clock;

    const ply = moveListPly();
    if (ply > 0) return ply % 2 === 0 ? 'w' : 'b';

    if (location.hostname.includes('chess.com') && /\/puzzles\//i.test(location.pathname)) {
      return orientation === 'black' ? 'b' : 'w';
    }

    return 'w';
  }

  function castlingRights(_pieces) {
    // Piece placement alone cannot prove castling rights. Granting rights
    // merely because a king/rook is still on its home square can create an
    // impossible FEN after those pieces have previously moved.
    return '-';
  }

  function pathClear(pieces, from, to) {
    const fx = FILES.indexOf(from[0]);
    const fy = Number(from[1]) - 1;
    const tx = FILES.indexOf(to[0]);
    const ty = Number(to[1]) - 1;
    const dx = Math.sign(tx - fx);
    const dy = Math.sign(ty - fy);

    let x = fx + dx;
    let y = fy + dy;
    while (x !== tx || y !== ty) {
      if (pieces[FILES[x] + (y + 1)]) return false;
      x += dx;
      y += dy;
    }
    return true;
  }

  function isPseudoLegalMove(pieces, turn, from, to) {
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return false;

    const piece = pieces[from];
    const target = pieces[to];
    if (!piece || piece[0] !== turn) return false;
    if (target && target[0] === turn) return false;

    const type = piece[1];
    const fx = FILES.indexOf(from[0]);
    const fy = Number(from[1]) - 1;
    const tx = FILES.indexOf(to[0]);
    const ty = Number(to[1]) - 1;
    const dx = tx - fx;
    const dy = ty - fy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (type === 'n') {
      return (adx === 1 && ady === 2) || (adx === 2 && ady === 1);
    }

    if (type === 'k') {
      return adx <= 1 && ady <= 1 && (adx + ady > 0);
    }

    if (type === 'b') {
      return adx === ady && adx > 0 && pathClear(pieces, from, to);
    }

    if (type === 'r') {
      return ((dx === 0) !== (dy === 0)) && pathClear(pieces, from, to);
    }

    if (type === 'q') {
      const lineMove = (dx === 0) || (dy === 0) || (adx === ady);
      return lineMove && (adx > 0 || ady > 0) && pathClear(pieces, from, to);
    }

    if (type === 'p') {
      const direction = turn === 'w' ? 1 : -1;
      const startRank = turn === 'w' ? 2 : 7;
      if (dx === 0 && !target && dy === direction) return true;
      if (dx === 0 && !target && Number(from[1]) === startRank && dy === 2 * direction) {
        const middle = from[0] + (Number(from[1]) + direction);
        return !pieces[middle];
      }
      return adx === 1 && dy === direction && !!target && target[0] !== turn;
    }

    return false;
  }

  function validateEngineMove(data, position) {
    const from = data?.from;
    const to = data?.to;
    if (!from || !to || !position?.pieces) {
      return { ok: false, reason: 'Engine did not return a complete move.' };
    }

    if (data.turn && data.turn !== position.turn) {
      return {
        ok: false,
        reason: `Engine turn ${data.turn} disagrees with board turn ${position.turn}.`
      };
    }

    if (!isPseudoLegalMove(position.pieces, position.turn, from, to)) {
      const piece = position.pieces[from] || 'empty';
      return {
        ok: false,
        reason: `Rejected ${from}${to}: ${piece} cannot legally move that way in the parsed position.`
      };
    }

    return { ok: true };
  }

  function buildPosition() {
    const board = getBoard();
    if (!board) return null;
    const orientation = boardOrientation(board);
    const pieces = readPieces(board, orientation);
    if (!pieces) return null;
    const turn = detectTurn(board, pieces, orientation);
    const ply = moveListPly();
    const fullmove = Math.floor(ply / 2) + 1;
    return {
      board,
      orientation,
      pieces,
      turn,
      fen: `${boardPart(pieces)} ${turn} ${castlingRights(pieces)} - 0 ${fullmove}`
    };
  }

  function isMyTurn(position) {
    // On puzzle pages the solver is always the side to play.
    if (location.hostname.includes('chess.com') && /\/puzzles\//i.test(location.pathname)) return true;

    const playerColor = position.orientation === 'black' ? 'b' : 'w';
    return position.turn === playerColor;
  }

  function squarePoint(square, rect, orientation) {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]) - 1;
    if (file < 0 || rank < 0) return null;
    const xf = orientation === "black" ? 7 - file : file;
    const yr = orientation === "black" ? rank : 7 - rank;
    return {x: rect.left + (xf + .5) * rect.width / 8, y: rect.top + (yr + .5) * rect.height / 8};
  }

  function clearArrow() { document.getElementById("cae-arrow-overlay")?.remove(); }

  function drawImperfectArrow(from, to) {
    clearArrow();
    if (!from || !to || !state.board || !isStudyOrAnalysisPage()) return;
    const rect = state.board.getBoundingClientRect();
    const a = squarePoint(from, rect, state.orientation);
    const b = squarePoint(to, rect, state.orientation);
    if (!a || !b) return;

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.id = "cae-arrow-overlay";
    svg.setAttribute("width", String(innerWidth));
    svg.setAttribute("height", String(innerHeight));
    svg.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);

    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", "chp-imperfect-head");
    marker.setAttribute("markerWidth", "11");
    marker.setAttribute("markerHeight", "11");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5.5");
    marker.setAttribute("orient", "auto");
    const head = document.createElementNS(ns, "path");
    head.setAttribute("d", "M 0 0 L 11 5.5 L 0 11 z");
    head.setAttribute("fill", "#ff5a36");
    marker.appendChild(head); defs.appendChild(marker); svg.appendChild(defs);

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(a.x));
    line.setAttribute("y1", String(a.y));
    line.setAttribute("x2", String(b.x));
    line.setAttribute("y2", String(b.y));
    line.setAttribute("stroke", "#ff5a36");
    line.setAttribute("stroke-width", String(Math.max(6, rect.width / 95)));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", ".92");
    line.setAttribute("marker-end", "url(#chp-imperfect-head)");
    svg.appendChild(line);
    document.documentElement.appendChild(svg);
  }

  function drawArrow(from, to) {
    clearArrow();
    if (!state.showArrow || !from || !to || !state.board) return;
    const rect = state.board.getBoundingClientRect();
    const a = squarePoint(from, rect, state.orientation);
    const b = squarePoint(to, rect, state.orientation);
    if (!a || !b) return;

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.id = "cae-arrow-overlay";
    svg.setAttribute("width", String(innerWidth));
    svg.setAttribute("height", String(innerHeight));
    svg.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);

    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", "chp-head");
    marker.setAttribute("markerWidth", "11");
    marker.setAttribute("markerHeight", "11");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5.5");
    marker.setAttribute("orient", "auto");
    const head = document.createElementNS(ns, "path");
    head.setAttribute("d", "M 0 0 L 11 5.5 L 0 11 z");
    head.setAttribute("fill", "#22d3ee");
    marker.appendChild(head); defs.appendChild(marker); svg.appendChild(defs);

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(a.x));
    line.setAttribute("y1", String(a.y));
    line.setAttribute("x2", String(b.x));
    line.setAttribute("y2", String(b.y));
    line.setAttribute("stroke", "#22d3ee");
    line.setAttribute("stroke-width", String(Math.max(6, rect.width / 95)));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", ".9");
    line.setAttribute("marker-end", "url(#chp-head)");
    svg.appendChild(line);
    document.documentElement.appendChild(svg);
  }

  function ensurePanel() {
    let p = document.getElementById("cae-live-panel");
    if (p) return p;
    p = document.createElement("div");
    p.id = "cae-live-panel";
    p.innerHTML = `
      <div class="chp-head">
        <div class="chp-brand"><div class="chp-mark">♞</div><div><div class="chp-title">Chess Analysis Engine</div><div class="chp-sub">LIVE BOARD ANALYSIS</div></div></div>
        <div class="chp-badge">STOCKFISH</div>
      </div>
      <div class="chp-move" id="chp-move">Waiting</div>
      <div class="chp-eval" id="chp-eval">Waiting for your turn</div>
      <div class="chp-line" id="chp-line">Board detected. Analysis will appear here.</div>
      <div class="chp-foot"><span id="chp-site">Chess site</span><span id="chp-depth">—</span></div>
      <div class="chp-error chp-hidden" id="chp-error"></div>`;
    document.documentElement.appendChild(p);
    return p;
  }

  function removePanel() { document.getElementById("cae-live-panel")?.remove(); }

  function renderWaiting(text) {
    const key = `waiting|${text}|${state.showPanel}|${state.site}`;
    if (state.lastPanelKey === key) return;
    state.lastPanelKey = key;

    const p = ensurePanel();
    p.classList.toggle("chp-hidden", !state.showPanel);
    p.querySelector("#chp-move").textContent = "Waiting";
    p.querySelector("#chp-eval").textContent = text;
    p.querySelector("#chp-line").textContent = `${state.site} board detected.`;
    p.querySelector("#chp-site").textContent = state.site;
    p.querySelector("#chp-depth").textContent = "—";
    p.querySelector("#chp-error").classList.add("chp-hidden");
  }

  function render(data) {
    const move = data.san || data.move || "No move";
    const ev = data.mate != null ? `Mate in ${Math.abs(data.mate)}` : `Eval ${Number(data.eval ?? 0).toFixed(2)}`;
    const line = Array.isArray(data.continuationArr) ? data.continuationArr.join(" ") : "No continuation returned";
    const depth = `D${data.depth ?? "?"}`;
    const key = `result|${move}|${ev}|${line}|${depth}|${state.showPanel}|${state.site}`;
    if (state.lastPanelKey === key) return;
    state.lastPanelKey = key;

    const p = ensurePanel();
    p.classList.toggle("chp-hidden", !state.showPanel);
    p.querySelector("#chp-move").textContent = move;
    p.querySelector("#chp-eval").textContent = `${ev} · target ${data.targetElo ?? state.elo}`;
    p.querySelector("#chp-line").textContent = line;
    p.querySelector("#chp-site").textContent = state.site;
    p.querySelector("#chp-depth").textContent = depth;
    p.querySelector("#chp-error").classList.add("chp-hidden");
  }

  function renderError(message) {
    const key = `error|${message}|${state.showPanel}|${state.site}`;
    if (state.lastPanelKey === key) return;
    state.lastPanelKey = key;

    const p = ensurePanel();
    p.classList.toggle("chp-hidden", !state.showPanel);
    p.querySelector("#chp-move").textContent = "Engine error";
    p.querySelector("#chp-eval").textContent = "No result";
    const e = p.querySelector("#chp-error");
    e.textContent = message;
    e.classList.remove("chp-hidden");
  }

  function isStudyOrAnalysisPage() {
    const path = location.pathname.toLowerCase();
    return /\/(analysis|study)(?:\/|$)/.test(path);
  }

  function isChessComBotGame() {
    if (!location.hostname.includes("chess.com")) return false;
    const path = location.pathname.toLowerCase();
    return path === "/play/computer" || path.startsWith("/play/computer/");
  }

  // Single source of truth for where this extension is allowed to do anything
  // at all. Supported contexts: chess.com "Play Computer" games (unrated, vs a
  // bot) and analysis / study boards. A live game against a human opponent is
  // NOT a supported context: no board reading, no engine call, no overlay and
  // no move execution. Anything outside this predicate stays completely inert.
  // See the "Fair play and scope" section of the README.
  function isSupportedContext() {
    return isStudyOrAnalysisPage() || isChessComBotGame();
  }

  function resetWeakSchedule() {
    autoMoveController.configure(state);
    autoMoveController.resetWeakSchedule();
    state.moveCount = autoMoveController.moveCount;
    state.nextWeakAt = autoMoveController.nextWeakAt;
  }

  function normalizeSelectedMove(selection, data) {
    const selected = selection?.move || data;
    if (!selected) return data;
    return {
      ...data,
      ...selected,
      from: selected.from || data.from,
      to: selected.to || data.to,
      san: selected.san || selected.move || data.san || data.move,
      eval: selected.eval ?? selected.score ?? data.eval,
      targetElo: data.targetElo ?? state.elo
    };
  }

  function applyDisplayMove(data, selection = null) {
    const selected = normalizeSelectedMove(selection, data);
    state.selectedDisplayMove = selected;

    if (
      selection?.imperfect &&
      selected?.from &&
      selected?.to &&
      isStudyOrAnalysisPage()
    ) {
      drawImperfectArrow(selected.from, selected.to);
    } else if (selected?.from && selected?.to) {
      drawArrow(selected.from, selected.to);
    }

    state.moveCount = autoMoveController.moveCount;
    state.nextWeakAt = autoMoveController.nextWeakAt;

    return {
      move: selected,
      simulatedWeak: Boolean(selection?.imperfect)
    };
  }

  function applySettingsToController() {
    autoMoveController.configure(state);
  }

  async function analyze(position) {
    if (!position?.fen || state.dragging || state.analyzing) return;

    state.analyzing = true;
    const id = ++state.requestId;
    const expectedFen = position.fen;
    state.engineFen = expectedFen;

    applySettingsToController();
    sendStatus('Analyzing', 'Engine request');

    try {
      const selection = await autoMoveController.startAnalysis(
        expectedFen,
        { allowImperfect: isStudyOrAnalysisPage() || isChessComBotGame() }
      );

      if (id !== state.requestId || !selection) return;

      const current = buildPosition();
      if (
        !current ||
        current.fen !== expectedFen ||
        !isMyTurn(current) ||
        state.dragging
      ) {
        clearArrow();
        state.result = null;
        state.lastPanelKey = null;
        sendStatus('Waiting', 'Position changed, discarded stale result');
        scheduleScan(120);
        return;
      }

      const selectedData = normalizeSelectedMove(
        selection,
        selection.analysis
      );

      const legality = validateEngineMove(selectedData, current);
      if (!legality.ok) {
        clearArrow();
        renderError(legality.reason);
        sendStatus('Error', legality.reason);
        state.result = null;
        return;
      }

      state.result = selection.analysis;
      const display = applyDisplayMove(selection.analysis, selection);
      render(display.move);

        if (display.simulatedWeak) {
        const p = ensurePanel();
        p.querySelector('#chp-line').textContent =
          isChessComBotGame()
            ? 'IMPERFECT MOVE · bot game'
            : 'SIMULATED IMPERFECT MOVE · analysis/study mode';
      }

      if (state.autoplay && isSupportedContext()) {
        // The controller is wired into the non-game analysis workflow.
        // Platform-specific live-game submission is deliberately not enabled.
        await scheduleAnalysisMove(selection.move, expectedFen);
      }

      sendStatus(
        'Analysis',
        display.simulatedWeak
          ? 'Simulated imperfect move'
          : (display.move?.san || display.move?.move || 'Best move ready')
      );
    } catch (error) {
      if (id !== state.requestId) return;
      renderError(error?.message || String(error));
      sendStatus('Error', error?.message || 'Engine request failed');
    } finally {
      if (id === state.requestId) {
        state.analyzing = false;
      }
    }
  }

  function scheduleAnalysisMove(move, expectedFen) {
    if (!move?.from || !move?.to || !isSupportedContext()) {
      return Promise.resolve(false);
    }

    const min = Math.max(100, Math.min(10000, Number(state.minDelay) || 300));
    const max = Math.max(min, Math.min(10000, Number(state.maxDelay) || 4000));
    const delay = state.enabled
      ? min + Math.floor(Math.random() * (max - min + 1))
      : 0;

    autoMoveController.setState('WAITING TO EXECUTE');

    return new Promise(resolve => {
      setTimeout(() => {
        if (state.dragging || !state.enabled) {
          autoMoveController.reset();
          resolve(false);
          return;
        }

        const current = buildPosition();
        if (!current || current.fen !== expectedFen || !isMyTurn(current)) {
          autoMoveController.reset();
          resolve(false);
          return;
        }

        const ok = autoMoveController.executeMove(move);
        resolve(Boolean(ok));
      }, delay);
    });
  }

  function scan() {
    if (state.scanInProgress) return;
    state.scanInProgress = true;

    try {
      if (!state.enabled) {
        clearArrow();
        removePanel();
        state.lastFen = null;
        state.stableFenCandidate = null;
        state.stableFenSince = 0;
        state.stableTurn = null;
        state.engineFen = null;
        return;
      }

      // Hard stop for anything that is not a supported context. This is what
      // keeps the extension inert on live games against human opponents: we
      // never read the board, never call the engine and never draw anything.
      if (!isSupportedContext()) {
        clearArrow();
        removePanel();
        state.lastFen = null;
        state.stableFenCandidate = null;
        state.stableFenSince = 0;
        state.stableTurn = null;
        state.engineFen = null;
        state.result = null;
        state.selectedDisplayMove = null;
        state.previousPieces = null;
        sendStatus("Waiting", "Engine disabled on live games");
        return;
      }

      const position = buildPosition();
      if (!position) {
        clearArrow();
        renderWaiting("No supported board detected");
        sendStatus("Waiting", "No supported board detected");
        return;
      }

      state.board = position.board;
      state.orientation = position.orientation;
      attachBoardObserver(position.board);
      attachBoardPointerHandlers(position.board);

      const inferredTurn = inferTurnFromPositionDelta(state.previousPieces, position.pieces);
      if (inferredTurn) {
        state.stableTurn = inferredTurn;
      } else if (!state.stableTurn) {
        state.stableTurn = position.turn;
      }

      position.turn = state.stableTurn;
      position.fen = `${boardPart(position.pieces)} ${position.turn} ${castlingRights(position.pieces)} - 0 ${Math.floor(moveListPly() / 2) + 1}`;
      state.currentTurn = position.turn;

      const changed = position.fen !== state.stableFenCandidate;
      if (changed) {
        state.stableFenCandidate = position.fen;
        state.stableFenSince = performance.now();
        state.previousPieces = {...position.pieces};
        state.lastFen = null;
        state.engineFen = null;
        state.result = null;
        clearArrow();
        scheduleScan(140);
        return;
      }

      state.previousPieces = {...position.pieces};

      if (state.dragging) {
        clearArrow();
        sendStatus("Waiting", "Move in progress");
        return;
      }

      if (!isMyTurn(position)) {
        clearArrow();
        renderWaiting(`Opponent to move · ${position.turn === "w" ? "White" : "Black"}`);
        sendStatus("Waiting", "Opponent to move");
        state.engineFen = null;
        state.lastFen = position.fen;
        return;
      }

      const stableLongEnough = performance.now() - state.stableFenSince >= 120;
      if (!stableLongEnough) {
        scheduleScan(140);
        return;
      }

      if (position.fen !== state.lastFen && position.fen !== state.engineFen && !state.analyzing) {
        state.lastFen = position.fen;
        analyze(position);
      }
    } finally {
      state.lastScanAt = performance.now();
      state.scanInProgress = false;
    }
  }

  function scheduleScan(delay = 120) {
    if (!state.enabled || state.scanQueued) return;
    state.scanQueued = true;
    setTimeout(() => {
      state.scanQueued = false;
      scan();
    }, Math.max(0, delay));
  }

  function attachBoardPointerHandlers(board) {
    if (!board || state.pointerBoundBoard === board) return;

    state.pointerBoundBoard = board;

    const begin = event => {
      if (!state.enabled || event.button !== 0) return;
      state.dragging = true;
      state.requestId++;
      state.analyzing = false;
      state.engineFen = null;
      clearArrow();
      sendStatus("Waiting", "Move in progress");
    };

    const end = () => {
      if (!state.dragging) return;
      state.dragging = false;
      state.stableFenCandidate = null;
      state.stableFenSince = 0;
      scheduleScan(220);
    };

    board.addEventListener('pointerdown', begin, {capture:true, passive:true});
    board.addEventListener('pointerup', end, {capture:true, passive:true});
    board.addEventListener('pointercancel', end, {capture:true, passive:true});
    board.addEventListener('touchstart', () => {
      state.dragging = true;
      state.requestId++;
      state.analyzing = false;
      state.engineFen = null;
      clearArrow();
    }, {capture:true, passive:true});
    board.addEventListener('touchend', end, {capture:true, passive:true});
    board.addEventListener('touchcancel', end, {capture:true, passive:true});
    window.addEventListener('pointerup', end, {capture:true, passive:true});
    window.addEventListener('pointercancel', end, {capture:true, passive:true});
  }

  function attachBoardObserver(board) {
    if (!board || state.observedBoard === board) return;

    state.boardObserver?.disconnect();
    state.boardObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          scheduleScan(150);
          break;
        }

        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (target?.matches?.('piece, .piece, square, .square, cg-board > *')) {
            scheduleScan(150);
            break;
          }
        }
      }
    });

    state.boardObserver.observe(board, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    state.observedBoard = board;
  }

  function dispatchBoardSquareClick(square) {
    if (!state.board || !/^[a-h][1-8]$/.test(square)) return false;

    const rect = state.board.getBoundingClientRect();
    const point = squarePoint(square, rect, state.orientation);
    if (!point) return false;

    const target = document.elementFromPoint(point.x, point.y) || state.board;
    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

    for (const type of events) {
      const Ctor = type.startsWith('pointer') ? window.PointerEvent : window.MouseEvent;
      target.dispatchEvent(new Ctor(type, {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons: type.endsWith('down') ? 1 : 0,
        view: window
      }));
    }

    return true;
  }

  function requestMoveExecution(move, expectedFen) {
    if (!isSupportedContext()) return false;
    if (!move?.from || !move?.to || !expectedFen) return false;

    const current = buildPosition();
    if (!current || current.fen !== expectedFen || !isMyTurn(current)) {
      autoMoveController.reset();
      return false;
    }

    autoMoveController.setState('EXECUTING');
    sendStatus("Executing", `${move.from}${move.to}`);
    const first = dispatchBoardSquareClick(move.from);
    if (!first) {
      autoMoveController.reset();
      return false;
    }

    setTimeout(() => {
      if (state.dragging) {
        autoMoveController.reset();
        return;
      }

      const second = dispatchBoardSquareClick(move.to);
      if (!second) {
        autoMoveController.reset();
        sendStatus("Error", "Move execution failed");
        return;
      }

      setTimeout(() => {
        autoMoveController.verifyMove(move);
      }, 320);
    }, 90);

    return true;
  }

  function verifyMoveResult(move) {
    const expected = autoMoveController.currentFen;
    const current = buildPosition();
    if (!current || !move?.from || !move?.to) {
      autoMoveController.reset();
      return false;
    }

    // The old position should no longer be present after a successfully
    // executed move. We intentionally do not assume success merely because
    // the synthetic click sequence was dispatched.
    if (expected && current.fen === expected) {
      autoMoveController.reset();
      sendStatus("Error", "Move was not accepted by the board");
      scheduleScan(180);
      return false;
    }

    state.lastFen = null;
    state.engineFen = null;
    state.result = null;
    state.stableFenCandidate = null;
    state.stableFenSince = 0;
    clearArrow();
    autoMoveController.setState('IDLE');
    sendStatus("Waiting", "Move accepted");
    scheduleScan(260);
    return true;
  }

  async function init() {
    Object.assign(state, await chrome.storage.local.get(DEFAULTS));
    applySettingsToController();
    boardAdapter.setReadPositionHandler(() => {
      const position = buildPosition();
      if (position) position.allowImperfect = isStudyOrAnalysisPage() || isChessComBotGame();
      return position;
    });
    boardAdapter.setExecutionHandler(requestMoveExecution);
    boardAdapter.setVerifyHandler(verifyMoveResult);
    state.site = siteName();
    state.previousPieces = null;
    state.stableFenCandidate = null;
    state.stableFenSince = 0;
    state.stableTurn = null;
    scan();
  }

  chrome.storage.onChanged.addListener(changes => {
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) state[key] = changes[key].newValue;
    }
    state.lastFen = null;
    state.lastPanelKey = null;
    state.stableFenCandidate = null;
    state.stableFenSince = 0;
    state.stableTurn = null;
    state.engineFen = null;
    state.requestId++;
    state.analyzing = false;
    applySettingsToController();
    autoMoveController.reset();

    if (!state.enabled) {
      clearArrow();
      removePanel();
      sendStatus("Waiting", "Disabled");
    } else {
      scheduleScan(0);
    }
  });

  // Low-frequency safety net for SPA navigation / board replacement.
  setInterval(() => {
    if (state.enabled) scheduleScan(0);
  }, 1000);

  let redrawQueued = false;
  function scheduleRedraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      const displayed = state.selectedDisplayMove || state.result;
      if (displayed?.from && displayed?.to) {
        if (state.selectedDisplayMove?.imperfect) {
          drawImperfectArrow(displayed.from, displayed.to);
        } else {
          drawArrow(displayed.from, displayed.to);
        }
      }
    });
  }

  addEventListener("resize", scheduleRedraw, {passive:true});
  addEventListener("scroll", scheduleRedraw, {passive:true});

  init();
})();
