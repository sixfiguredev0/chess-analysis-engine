const engineController = new EngineController();
const bestMovePolicy = new BestMovePolicy([]);
const imperfectMovePolicy = new ImperfectMovePolicy([]);
const autoMoveController = new AutoMoveController(
  engineController,
  bestMovePolicy,
  imperfectMovePolicy
);

function syncControllerSettings() {
  autoMoveController.configure(AppSettings.getSettings());
}

async function initApp() {
  await AppSettings.load();
  syncControllerSettings();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  const patch = {};
  for (const [key, change] of Object.entries(changes)) {
    patch[key] = change.newValue;
  }

  AppSettings.setSettings(patch);
  syncControllerSettings();
});

initApp();

globalThis.ChessAnalysisApp = {
  engineController,
  bestMovePolicy,
  imperfectMovePolicy,
  autoMoveController
};
