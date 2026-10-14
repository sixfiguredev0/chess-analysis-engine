class BoardAdapter {
  constructor() {
    this.readPositionHandler = null;
    this.executionHandler = null;
    this.verifyHandler = null;
  }

  setReadPositionHandler(handler) {
    this.readPositionHandler = handler;
  }

  setExecutionHandler(handler) {
    this.executionHandler = handler;
  }

  setVerifyHandler(handler) {
    this.verifyHandler = handler;
  }

  updateBoard() {
    return this.readPositionHandler ? this.readPositionHandler() : null;
  }

  analyzeBoard() {
    const position = this.updateBoard();
    if (!position || !globalThis.ChessAnalysisApp?.autoMoveController) {
      return null;
    }
    return globalThis.ChessAnalysisApp.autoMoveController.startAnalysis(
      position.fen,
      { allowImperfect: position.allowImperfect }
    );
  }

  selectMove(move) {
    return this.executeMove(move);
  }

  requestMoveExecution(move, expectedFen) {
    return this.executionHandler
      ? this.executionHandler(move, expectedFen)
      : false;
  }

  executeMove(move) {
    return this.requestMoveExecution(move, null);
  }

  verifyMoveResult(move) {
    return this.verifyHandler ? this.verifyHandler(move) : Boolean(move);
  }
}

globalThis.BoardAdapter = BoardAdapter;
