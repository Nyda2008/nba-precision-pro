
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { backtestGames } = require('./backtest-engine');

test('Advanced basketball backtesting statistics', () => {
  const games = [
    {
      gameId: '401900001',
      gameDate: '2026-10-01T23:00:00Z',
      firstHalfTotal: 100,
      secondHalfTotal: 96
    },
    {
      gameId: '401900002',
      gameDate: '2026-10-02T23:00:00Z',
      firstHalfTotal: 100,
      secondHalfTotal: 106
    },
    {
      gameId: '401900003',
      gameDate: '2026-11-01T23:00:00Z',
      firstHalfTotal: 100,
      secondHalfTotal: 100
    },
    {
      gameId: '401900004',
      gameDate: '2026-11-02T23:00:00Z',
      firstHalfTotal: 100,
      secondHalfTotal: 90
    }
  ];

  const report = backtestGames(games);

  assert.equal(report.gamesTested, 4);
  assert.equal(report.results.length, 4);

  const metrics = report.metrics;

  assert.equal(metrics.meanAbsoluteError, 5);
  assert.equal(metrics.averageBias, 2);
  assert.equal(metrics.rootMeanSquaredError, 6.16);

  assert.equal(metrics.medianAbsoluteError, 5);
  assert.equal(metrics.p90AbsoluteError, 10);

  assert.equal(metrics.within5Points, 50);
  assert.equal(metrics.within10Points, 100);
  assert.equal(metrics.within15Points, 100);

  assert.equal(metrics.predictedOver, 2);
  assert.equal(metrics.predictedUnder, 1);
  assert.equal(metrics.predictedExactly, 1);

  assert.equal(report.monthlyAccuracy.length, 2);

  assert.deepEqual(report.monthlyAccuracy[0], {
    month: '2026-10',
    gamesTested: 2,
    meanAbsoluteError: 5,
    averageBias: -1
  });

  assert.deepEqual(report.monthlyAccuracy[1], {
    month: '2026-11',
    gamesTested: 2,
    meanAbsoluteError: 5,
    averageBias: 5
  });

  assert.equal(
    report.results[0].gameDate,
    '2026-10-01T23:00:00Z'
  );

  assert.equal(report.results[0].error, 4);
  assert.equal(report.results[1].error, -6);
  assert.equal(report.results[2].error, 0);
  assert.equal(report.results[3].error, 10);
});

test('Empty backtesting data', () => {
  const report = backtestGames([]);

  assert.equal(report.gamesTested, 0);
  assert.equal(report.metrics, null);
  assert.deepEqual(report.results, []);
  assert.deepEqual(report.monthlyAccuracy, []);
});

test('Invalid games are skipped', () => {
  const report = backtestGames([
    {
      gameId: '401900005',
      firstHalfTotal: null,
      secondHalfTotal: 100
    },
    {
      gameId: '401900006',
      firstHalfTotal: 100,
      secondHalfTotal: 'invalid'
    },
    {
      gameId: '401900007',
      gameDate: null,
      firstHalfTotal: 100,
      secondHalfTotal: 100
    }
  ]);

  assert.equal(report.gamesTested, 1);
  assert.equal(report.metrics.predictedExactly, 1);
  assert.deepEqual(report.monthlyAccuracy, []);
});

test('Rejects non-array input', () => {
  assert.throws(
    () => backtestGames(null),
    /Games must be an array/
  );
});
