class AutoMoveController {
  constructor(engineController, bestMovePolicy, imperfectMovePolicy = null) {
    this.engineController = engineController;
    this.moveSelectionPolicy = bestMovePolicy;
    this.bestMovePolicy = bestMovePolicy;
    this.imperfectMovePolicy = imperfectMovePolicy || bestMovePolicy;

    this.state = 'IDLE';
    this.boardAdapter = null;
    this.currentFen = null;
    this.analysisId = 0;
    this.busy = false;

    this.moveCount = 0;
    this.nextWeakAt = null;
    this.lastWasWeak = false;
  }

  attachBoardAdapter(boardAdapter) {
    this.boardAdapter = boardAdapter;
  }

  setState(newState) {
    this.state = newState;
  }

  getState() {
    return this.state;
  }

  configure(settings = {}) {
    this.settings = {...settings};
  }

  invalidateAnalysis() {
    this.analysisId++;
    this.engineController.cancel?.();
    this.busy = false;
    this.currentFen = null;
    this.setState('IDLE');
  }

  resetWeakSchedule() {
    const min = Math.max(1, Number(this.settings?.minWeakInterval) || 8);
    const max = Math.max(min, Number(this.settings?.maxWeakInterval) || 20);
    this.nextWeakAt = min + Math.floor(Math.random() * (max - min + 1));
    this.moveCount = 0;
  }

  shouldUseImperfect(allowImperfect) {
    if (!allowImperfect || !this.settings?.imperfectMoves) {
      return false;
    }

    if (this.nextWeakAt == null) {
      this.resetWeakSchedule();
    }

    this.moveCount++;

    if (this.moveCount < this.nextWeakAt) {
      return false;
    }

    this.resetWeakSchedule();
    return true;
  }

  async startAnalysis(boardFen, options = {}) {
    if (!boardFen || this.busy) return null;

    const request = ++this.analysisId;
    this.currentFen = boardFen;
    this.busy = true;
    this.setState('ANALYZING');

    try {
      const result = await this.engineController.analyze(
        boardFen,
        Number(this.settings?.elo) || 1800
      );

      if (
        request !== this.analysisId ||
        this.currentFen !== boardFen ||
        !result
      ) {
        return null;
      }

      const candidates = Array.isArray(result.candidates)
        ? result.candidates
        : [result];

      this.bestMovePolicy.setCandidates(candidates);
      this.imperfectMovePolicy.setCandidates(candidates);

      const useImperfect = this.shouldUseImperfect(
        Boolean(options.allowImperfect)
      );

      this.moveSelectionPolicy = useImperfect
        ? this.imperfectMovePolicy
        : this.bestMovePolicy;

      this.lastWasWeak = useImperfect;
      this.setState('SELECTING MOVE');

      const move = this.selectMove();

      this.setState('IDLE');

      return {
        analysis: result,
        move,
        imperfect: useImperfect
      };
    } finally {
      if (request === this.analysisId) {
        this.busy = false;
      }
    }
  }

  selectMove() {
    return this.moveSelectionPolicy.select();
  }

  waitForTurn() {
    this.setState('WAITING FOR TURN');
  }

  executeMove(move) {
    this.setState('EXECUTING');

    if (!move) {
      this.setState('IDLE');
      return false;
    }

    if (this.boardAdapter?.requestMoveExecution) {
      return this.boardAdapter.requestMoveExecution(
        move,
        this.currentFen
      );
    }

    this.setState('IDLE');
    return false;
  }

  verifyMove(move) {
    this.setState('VERIFYING');

    const result = this.boardAdapter?.verifyMoveResult
      ? this.boardAdapter.verifyMoveResult(move)
      : Boolean(move);

    this.setState('IDLE');
    return result;
  }

  reset() {
    this.invalidateAnalysis();
    this.lastWasWeak = false;
  }
}

globalThis.AutoMoveController = AutoMoveController;
