function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const from = candidate.from || candidate.uci?.slice(0, 2) || candidate.move?.slice(0, 2);
  const to = candidate.to || candidate.uci?.slice(2, 4) || candidate.move?.slice(2, 4);

  return {
    ...candidate,
    from,
    to,
    score: Number(candidate.score ?? candidate.eval ?? candidate.centipawns ?? 0)
  };
}

class BestMovePolicy {
  constructor(candidates = []) {
    this.candidates = candidates.map(normalizeCandidate).filter(Boolean);
  }

  setCandidates(candidates = []) {
    this.candidates = candidates.map(normalizeCandidate).filter(Boolean);
  }

  select() {
    return this.candidates[0] ?? null;
  }
}

class ImperfectMovePolicy {
  constructor(candidates = []) {
    this.candidates = candidates.map(normalizeCandidate).filter(Boolean);
  }

  setCandidates(candidates = []) {
    this.candidates = candidates.map(normalizeCandidate).filter(Boolean);
  }

  select() {
    if (!this.candidates.length) return null;

    const ranked = [...this.candidates].sort((a, b) => b.score - a.score);

    // Never invent a move. If no alternate candidate exists, gracefully fall
    // back to the engine's best move.
    if (ranked.length < 2) return ranked[0];

    const pool = ranked.slice(1, Math.min(ranked.length, 4));
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

globalThis.BestMovePolicy = BestMovePolicy;
globalThis.ImperfectMovePolicy = ImperfectMovePolicy;
globalThis.BoundedRegretPolicy = BoundedRegretPolicy;


class BoundedRegretPolicy {
  constructor(candidates = [], options = {}) {
    this.candidates = candidates.map(normalizeCandidate).filter(Boolean);
    this.maxCentipawnLoss = Number(options.maxCentipawnLoss ?? 50);
  }

  setCandidates(candidates = []) {
    this.candidates = candidates.map(normalizeCandidate).filter(Boolean);
  }

  setMaxCentipawnLoss(value) {
    this.maxCentipawnLoss = Math.max(0, Number(value) || 0);
  }

  select() {
    if (!this.candidates.length) return null;

    const ranked = [...this.candidates].sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (ranked.length < 2) return best;

    // Choose only among alternatives whose evaluation is within a bounded
    // loss of the best move. This is intended for study/analysis simulation,
    // not for concealing engine assistance in live rated play.
    const pool = ranked.filter(candidate =>
      candidate !== best &&
      (best.score - candidate.score) <= this.maxCentipawnLoss
    );

    if (!pool.length) return best;
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

