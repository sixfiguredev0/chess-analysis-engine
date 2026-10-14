class EngineController {
  constructor() {
    this.candidates = [];
    this.requestId = 0;
  }

  getCandidates() {
    return [...this.candidates];
  }

  updateCandidates(newCandidates = []) {
    this.candidates = Array.isArray(newCandidates) ? [...newCandidates] : [];
  }

  async analyze(boardFen, elo = 1800) {
    if (!boardFen) {
      throw new Error('Cannot analyze an empty position.');
    }

    const requestId = ++this.requestId;

    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_FEN',
      fen: boardFen,
      elo
    });

    if (requestId !== this.requestId) {
      return null;
    }

    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }

    if (!response?.ok) {
      throw new Error(response?.error || 'Engine request failed.');
    }

    const data = response.data || {};

    // Accept several candidate shapes so the engine adapter is not tied to
    // one server response representation.
    const candidates = Array.isArray(data.candidates)
      ? data.candidates
      : Array.isArray(data.variants)
        ? data.variants
        : Array.isArray(response.candidates)
          ? response.candidates
          : [];

    this.updateCandidates(candidates.length ? candidates : [data]);

    return {
      ...data,
      candidates: candidates.length ? candidates : [data]
    };
  }

  cancel() {
    this.requestId++;
  }
}

globalThis.EngineController = EngineController;
