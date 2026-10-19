
'use strict';

const { predictGame } = require('./prediction-engine');

const SUPPORTED_LEAGUES = new Set(['nba', 'wnba']);
const MODEL_VERSION = 'experimental-possession-v1';

function parseScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function halftimeStatus(competition) {
  const status = competition?.status?.type;
  if (!status || status.completed === true) return false;
  return status.name === 'STATUS_HALFTIME' ||
    (typeof status.description === 'string' &&
      status.description.trim().toLowerCase() === 'halftime');
}

function parseFirstHalf(competitor) {
  const scores = competitor?.linescores;
  if (!Array.isArray(scores) || scores.length !== 2) return null;
  const periods = scores.map((item, index) => {
    const period = Number(item?.period ?? index + 1);
    const score = parseScore(item?.value ?? item?.displayValue);
    return period === index + 1 ? score : null;
  });
  if (periods.some(value => value === null)) return null;
  const total = periods[0] + periods[1];
  if (parseScore(competitor.score) !== total) return null;
  return total;
}

function parseBoxscoreTotals(group) {
  const statistics = group?.statistics?.[0];
  const labels = statistics?.labels;
  const totals = statistics?.totals;
  if (!Array.isArray(labels) || !Array.isArray(totals) ||
      labels.length !== totals.length) return null;
  const stats = {};
  for (let i = 0; i < labels.length; i++) {
    stats[labels[i]] = totals[i];
  }
  return stats;
}

function buildHalftimeInput(summary) {
  const competition = summary?.header?.competitions?.[0];
  if (!halftimeStatus(competition)) {
    return { reason: 'Game is not confirmed at halftime' };
  }

  const competitors = competition?.competitors;
  const playerGroups = summary?.boxscore?.players;
  if (!Array.isArray(competitors) || competitors.length !== 2 ||
      !Array.isArray(playerGroups)) {
    return { reason: 'Two teams and box-score groups are required' };
  }

  const teams = [];
  const seenSides = new Set();
  for (const competitor of competitors) {
    const id = String(competitor?.team?.id ?? '');
    const homeAway = competitor?.homeAway;
    const name = competitor?.team?.displayName;
    const points = parseFirstHalf(competitor);
    if (!id || !name || !['home', 'away'].includes(homeAway) ||
        seenSides.has(homeAway) || points === null) {
      return { reason: 'Incomplete or inconsistent halftime scores' };
    }
    seenSides.add(homeAway);
    const matches = playerGroups.filter(group =>
      String(group?.team?.id ?? '') === id
    );
    if (matches.length !== 1) {
      return { reason: 'Box-score teams cannot be matched uniquely' };
    }
    const stats = parseBoxscoreTotals(matches[0]);
    if (!stats || parseScore(stats.PTS) !== points) {
      return { reason: 'Box-score points do not match halftime scores' };
    }
    teams.push({ name, homeAway, firstHalfPoints: points, stats });
  }
  return { input: { snapshotPeriod: 'halftime', teams } };
}

/**
 * Called only with a newly fetched, single ESPN summary response.
 * Dependencies: a store exposing savePrediction(record), and optionally
 * predict (defaults to prediction-engine.predictGame).
 * Does not fetch, poll, or infer that stale data is a live halftime snapshot.
 */
function createHalftimeCollector({ store, predict = predictGame } = {}) {
  if (!store || typeof store.savePrediction !== 'function') {
    throw new Error('Prediction store required');
  }
  if (typeof predict !== 'function') {
    throw new Error('Prediction function required');
  }

  async function capture({ league, gameId, summary, observedAt } = {}) {
    if (!SUPPORTED_LEAGUES.has(league)) {
      return { status: 'skipped', reason: 'Unsupported league' };
    }
    if (!/^\d{5,15}$/.test(String(gameId ?? ''))) {
      return { status: 'skipped', reason: 'Invalid game ID' };
    }
    const timestamp = new Date(observedAt);
    if (!observedAt || !Number.isFinite(timestamp.getTime()) ||
        timestamp.getTime() > Date.now() + 60000) {
      return { status: 'skipped', reason: 'Invalid observation time' };
    }
    const { input, reason } = buildHalftimeInput(summary);
    if (!input) return { status: 'skipped', reason };

    const outcome = predict(input);
    if (outcome.modelUsed !== MODEL_VERSION) {
      return { status: 'skipped', reason: 'Advanced input unavailable' };
    }
    // The store uses INSERT ... ON CONFLICT DO NOTHING so the original
    // prediction for this game/model version cannot be overwritten.
    const result = await store.savePrediction({
      league,
      gameId: String(gameId),
      modelVersion: MODEL_VERSION,
      gameStatus: 'halftime',
      observedAt: timestamp.toISOString(),
      inputSnapshot: input,
      prediction: outcome
    });
    return {
      status: result.inserted ? 'saved' : 'already-saved',
      gameId: String(gameId),
      modelVersion: MODEL_VERSION
    };
  }

  return { capture };
}

module.exports = { createHalftimeCollector, buildHalftimeInput };
