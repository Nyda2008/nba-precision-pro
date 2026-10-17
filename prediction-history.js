
'use strict';

// Basketball Precision Pro
// Prediction history validation and scoring.
// Database storage will be connected separately.

function validatePrediction(p) {
  if (!p || typeof p !== 'object') {
    throw new Error('Prediction must be an object');
  }

  for (const key of ['gameId', 'league', 'modelVersion']) {
    if (typeof p[key] !== 'string' || !p[key].trim()) {
      throw new Error('Missing or invalid ' + key);
    }
  }

  if (!Number.isFinite(p.homeWinProbability) ||
      p.homeWinProbability < 0 ||
      p.homeWinProbability > 1) {
    throw new Error('Invalid win probability');
  }

  return {
    gameId: p.gameId,
    league: p.league,
    modelVersion: p.modelVersion,
    homeWinProbability: p.homeWinProbability,
    predictedAt: new Date().toISOString()
  };
}

function scorePrediction(prediction, homeWon) {
  if (typeof homeWon !== 'boolean') {
    throw new Error('Final outcome must be a boolean');
  }

  const p = prediction.homeWinProbability;

  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error('Invalid stored probability');
  }

  const actual = homeWon ? 1 : 0;

  return {
    brierScore: (p - actual) ** 2,
    predictedHomeWin: p > 0.5,
    actualHomeWin: homeWon
  };
}

module.exports = {
  validatePrediction,
  scorePrediction
};
