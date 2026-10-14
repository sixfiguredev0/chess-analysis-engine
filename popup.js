const DEFAULTS = {
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

const $ = id => document.getElementById(id);
let current = {...DEFAULTS};
let saveTimer = null;

function clampWeakIntervals() {
  let min = Number(current.minWeakInterval) || DEFAULTS.minWeakInterval;
  let max = Number(current.maxWeakInterval) || DEFAULTS.maxWeakInterval;
  min = Math.max(1, Math.min(50, min));
  max = Math.max(1, Math.min(100, max));
  if (min > max) max = min;
  current.minWeakInterval = min;
  current.maxWeakInterval = max;
}

function clampDelayIntervals() {
  let min = Number(current.minDelay) || DEFAULTS.minDelay;
  let max = Number(current.maxDelay) || DEFAULTS.maxDelay;
  min = Math.max(100, Math.min(10000, min));
  max = Math.max(100, Math.min(10000, max));
  if (min > max) max = min;
  current.minDelay = min;
  current.maxDelay = max;
}

function updateDelayLabels() {
  $('minDelayLabel').textContent = `${current.minDelay} ms`;
  $('maxDelayLabel').textContent = `${current.maxDelay} ms`;
  $('minDelayValue').textContent = `${current.minDelay}–${current.maxDelay} ms`;
}

function apply(s) {
  current = {...DEFAULTS, ...s};
  clampWeakIntervals();
  clampDelayIntervals();

  $('enabled').checked = Boolean(current.enabled);
  $('elo').value = String(current.elo);
  $('eloValue').textContent = String(current.elo);
  $('showArrow').checked = current.showArrow !== false;
  $('showPanel').checked = current.showPanel !== false;
  $('turnOverride').value = current.turnOverride || 'auto';
  $('autoplay').checked = Boolean(current.autoplay);
  $('minDelay').value = String(current.minDelay);
  $('maxDelay').value = String(current.maxDelay);
  updateDelayLabels();
  $('imperfectMoves').checked = Boolean(current.imperfectMoves);
  $('minWeakInterval').value = String(current.minWeakInterval);
  $('maxWeakInterval').value = String(current.maxWeakInterval);
  $('minWeakValue').textContent = String(current.minWeakInterval);
  $('maxWeakValue').textContent = String(current.maxWeakInterval);
  $('statusDot').classList.toggle('on', Boolean(current.enabled));

  const weakControls = $('weakControls');
  weakControls.classList.toggle('disabled', !current.imperfectMoves);
  $('minWeakInterval').disabled = !current.imperfectMoves;
  $('maxWeakInterval').disabled = !current.imperfectMoves;
}

function queueSave(patch) {
  current = {...current, ...patch};
  apply(current);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const toSave = {...current};
    await chrome.storage.local.set(toSave);
  }, 100);
}

$('enabled').addEventListener('change', e => queueSave({enabled: e.target.checked}));
$('elo').addEventListener('input', e => queueSave({elo: Number(e.target.value)}));
$('showArrow').addEventListener('change', e => queueSave({showArrow: e.target.checked}));
$('showPanel').addEventListener('change', e => queueSave({showPanel: e.target.checked}));
$('turnOverride').addEventListener('change', e => queueSave({turnOverride: e.target.value}));
$('autoplay').addEventListener('change', e => queueSave({autoplay: e.target.checked}));
$('minDelay').addEventListener('input', e => {
  const value = Number(e.target.value);
  queueSave({minDelay: value, maxDelay: Math.max(value, Number(current.maxDelay) || value)});
});
$('maxDelay').addEventListener('input', e => {
  const value = Number(e.target.value);
  queueSave({maxDelay: value, minDelay: Math.min(Number(current.minDelay) || value, value)});
});
$('imperfectMoves').addEventListener('change', e => queueSave({imperfectMoves: e.target.checked}));
$('minWeakInterval').addEventListener('input', e => {
  const value = Number(e.target.value);
  queueSave({minWeakInterval: value, maxWeakInterval: Math.max(value, Number(current.maxWeakInterval) || value)});
});
$('maxWeakInterval').addEventListener('input', e => {
  const value = Number(e.target.value);
  queueSave({maxWeakInterval: value, minWeakInterval: Math.min(Number(current.minWeakInterval) || value, value)});
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type !== 'POPUP_STATUS') return;
  $('siteLabel').textContent = msg.site || 'Supported board';
  $('lastResult').textContent = msg.result || 'Ready';
  $('modeLabel').textContent = msg.mode || 'Waiting';
  $('statusDot').classList.toggle('on', msg.mode === 'Analyzing' || msg.mode === 'Analysis');
});

chrome.runtime.sendMessage({type: 'GET_RUNTIME_STATUS'}, res => {
  if (res?.version) $('version').textContent = `v${res.version}`;
});

chrome.storage.local.get(DEFAULTS).then(apply);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const patch = {};
  for (const [key, change] of Object.entries(changes)) patch[key] = change.newValue;
  apply({...current, ...patch});
});
