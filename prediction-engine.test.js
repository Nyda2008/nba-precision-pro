
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { predictGame } = require('./prediction-engine');

function sampleGame() {
  return {
    snapshotPeriod: 'halftime',
    teams: [
      {
        name: 'Away Team',
        homeAway: 'away',
        firstHalfPoints: 58,
        stats: {
          FG: '22-45',
          '3PT': '8-20',
          FT: '6-8',
          OREB: '5',
          TO: '6',
          PTS: '58'
        }
      },
      {
        name: 'Home Team',
        homeAway: 'home',
        firstHalfPoints: 54,
        stats: {
          FG: '20-44',
          '3PT': '6-18',
          FT: '8-10',
          OREB: '5',
          TO: '7',
          PTS: '54'
        }
      }
    ]
  };
}

function close(actual, expected, tolerance = 0.03) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be close to ${expected}`
  );
}

test('Projects second-half and final totals', () => {
  const result = predictGame(sampleGame());

  assert.equal(result.firstHalfTotal, 112);
  assert.equal(result.baseline.secondHalfTotal, 112);
  assert.equal(result.baseline.finalTotal, 224);

  assert.equal(
    result.modelUsed,
    'experimental-possession-v1'
  );

  assert.ok(
    Number.isFinite(
      result.prediction.projectedSecondHalfTotal
    )
  );

  close(
    result.prediction.projectedFinalTotal,
    112 + result.prediction.projectedSecondHalfTotal
  );
});

test('Calculates possession-based scoring', () => {
  const result = predictGame(sampleGame());
  const prediction = result.prediction;

  const awayPossessions = 45 - 5 + 6 + 0.44 * 8;
  const homePossessions = 44 - 5 + 7 + 0.44 * 10;

  const sharedPace =
    (awayPossessions + homePossessions) / 2;

  close(
    prediction.projectedSecondHalfPossessionsPerTeam,
    sharedPace
  );

  const expectedAway =
    sharedPace * (58 / awayPossessions);

  const expectedHome =
    sharedPace * (54 / homePossessions);

  close(
    prediction.teams[0].projectedSecondHalfPoints,
    expectedAway
  );

  close(
    prediction.teams[1].projectedSecondHalfPoints,
    expectedHome
  );
});

test('Calculates second-half winner and margin', () => {
  const result = predictGame(sampleGame());
  const prediction = result.prediction;

  const away = prediction.teams[0];
  const home = prediction.teams[1];

  const expectedMargin =
    away.projectedSecondHalfPoints -
    home.projectedSecondHalfPoints;

  close(
    prediction.projectedSecondHalfResult.signedMargin,
    expectedMargin
  );

  assert.equal(
    prediction.projectedSecondHalfResult.winner,
    expectedMargin > 0
      ? 'Away Team'
      : expectedMargin < 0
        ? 'Home Team'
        : 'Tied'
  );
});

test('Calculates final winner and margin', () => {
  const result = predictGame(sampleGame());
  const prediction = result.prediction;

  const away = prediction.teams[0];
  const home = prediction.teams[1];

  const margin =
    away.projectedFinalPoints -
    home.projectedFinalPoints;

  close(
    prediction.projectedFinalResult.signedMargin,
    margin
  );

  assert.equal(
    prediction.projectedFinalResult.winner,
    margin > 0
      ? 'Away Team'
      : margin < 0
        ? 'Home Team'
        : 'Tied'
  );
});

test('Uses historical offensive ratings when available', () => {
  const game = sampleGame();

  game.historicalWeight = 1;
  game.teams[0].historicalOffensiveRating = 110;
  game.teams[1].historicalOffensiveRating = 105;

  const result = predictGame(game);
  const prediction = result.prediction;

  const pace =
    prediction.projectedSecondHalfPossessionsPerTeam;

  close(
    prediction.teams[0].projectedSecondHalfPoints,
    pace * 1.10
  );

  close(
    prediction.teams[1].projectedSecondHalfPoints,
    pace * 1.05
  );
});

test('Falls back when halftime statistics are missing', () => {
  const game = sampleGame();

  delete game.teams[0].stats;

  const result = predictGame(game);

  assert.equal(
    result.modelUsed,
    'first-half-baseline-v1'
  );

  assert.equal(
    result.prediction.projectedSecondHalfTotal,
    112
  );

  assert.equal(
    result.prediction.projectedFinalTotal,
    224
  );

  assert.equal(
    result.prediction.calibrated,
    false
  );
});

test('Rejects non-halftime advanced projections', () => {
  const game = sampleGame();

  game.snapshotPeriod = 'final';

  const result = predictGame(game);

  assert.equal(
    result.modelUsed,
    'first-half-baseline-v1'
  );

  assert.ok(
    result.warnings.some(
      warning => warning.includes('snapshotPeriod')
    )
  );
});

test('Rejects invalid inputs', () => {
  assert.throws(
    () => predictGame(null),
    /Exactly two teams/
  );

  assert.throws(
    () => predictGame({ teams: [] }),
    /Exactly two teams/
  );

  const game = sampleGame();
  game.historicalWeight = 2;

  assert.throws(
    () => predictGame(game),
    /historicalWeight/
  );
});

test('Rejects negative halftime team points', () => {
  const game = sampleGame();

  game.teams[0].firstHalfPoints = -10;

  assert.throws(
    () => predictGame(game),
    /nonnegative integer/
  );
});

test('Falls back when box-score values are invalid', () => {
  const game = sampleGame();

  game.teams[0].stats.FG = '50-40';

  const result = predictGame(game);

  assert.equal(
    result.modelUsed,
    'first-half-baseline-v1'
  );

  assert.equal(
    result.prediction.projectedFinalTotal,
    224
  );
});

test('Reports uncertainty without claiming calibration', () => {
  const result = predictGame(sampleGame());

  assert.equal(result.prediction.calibrated, false);
  assert.ok(Array.isArray(result.warnings));
  assert.ok(result.warnings.length > 0);
});
