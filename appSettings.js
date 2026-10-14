class AppSettings {
  static settings = {
    enabled: false,
    elo: 1800,
    showArrow: true,
    showPanel: true,
    turnOverride: 'auto',
    autoplay: false,
    minDelay: 300,
    maxDelay: 4000,
    imperfectMoves: false,
    minWeakInterval: 8,
    maxWeakInterval: 20
  };

  static setSettings(settings = {}) {
    this.settings = {...this.settings, ...settings};
  }

  static getSettings() {
    return {...this.settings};
  }

  static async load() {
    const stored = await chrome.storage.local.get(this.settings);
    this.setSettings(stored);
    return this.getSettings();
  }

  static async save(changes = {}) {
    this.setSettings(changes);
    await chrome.storage.local.set(changes);
  }
}

globalThis.AppSettings = AppSettings;
