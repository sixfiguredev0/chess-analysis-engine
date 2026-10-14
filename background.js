const API_URL = 'https://chess-api.com/v1';
const cache = new Map();
const inFlight = new Map();

function eloToDepth(elo) {
  const rating = Math.max(800, Math.min(2400, Number(elo) || 1800));
  if (rating <= 1000) return 8;
  if (rating <= 1200) return 9;
  if (rating <= 1400) return 10;
  if (rating <= 1600) return 12;
  if (rating <= 1800) return 14;
  if (rating <= 2000) return 16;
  return 18;
}

function keyFor(fen, elo) {
  return `${elo}|${fen}`;
}

async function analyzeFen(fen, elo) {
  const key = keyFor(fen, elo);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < 120000) return cached.data;

  if (inFlight.has(key)) return inFlight.get(key);

  const depth = eloToDepth(elo);
  const maxThinkingTime = Math.min(100, Math.max(50, Math.round(50 + (depth - 8) * 6)));

  const promise = (async () => {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({fen, depth, maxThinkingTime, variants: 5})
    });

    if (!response.ok) throw new Error(`Engine HTTP ${response.status}`);

    let data = await response.json();
    if (data?.type === 'error') throw new Error(data.text || data.error || 'Engine error');

    if (Array.isArray(data) && data.length) {
      data = data[0];
    }
    if (Array.isArray(data?.variants)) {
      data.candidates = data.variants;
    }
    data.depth = data.depth || depth;
    data.targetElo = elo;
    cache.set(key, {time: Date.now(), data});

    if (cache.size > 80) cache.delete(cache.keys().next().value);
    return data;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_RUNTIME_STATUS') {
    sendResponse({ok: true, version: chrome.runtime.getManifest().version});
    return;
  }

  if (message?.type !== 'ANALYZE_FEN') return;

  (async () => {
    const fen = String(message.fen || '').trim();
    if (!fen) throw new Error('Missing FEN');

    const elo = Math.max(800, Math.min(2400, Number(message.elo) || 1800));
    const data = await analyzeFen(fen, elo);
    sendResponse({ok: true, data});
  })().catch(err => sendResponse({ok: false, error: err?.message || String(err)}));

  return true;
});
