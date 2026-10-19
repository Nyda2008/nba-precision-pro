
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createBacktestStore } = require('./backtest-store');

test('PostgreSQL backtest storage, dates and accuracy', async () => {
  if (
    process.env.CI_TEST_DATABASE !== 'true' ||
    !process.env.DATABASE_URL
  ) {
    throw new Error(
      'Dedicated test database configuration required'
    );
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await pool.query(`
      CREATE TABLE backtest_results (
        league TEXT NOT NULL,
        game_id TEXT NOT NULL,
        game_date TIMESTAMPTZ,
        season_type TEXT NOT NULL DEFAULT 'unknown',
        first_half_total INTEGER NOT NULL,
        actual_second_half INTEGER NOT NULL,
        predicted_second_half INTEGER NOT NULL,
        predicted_total INTEGER NOT NULL,
        actual_total INTEGER NOT NULL,
        error INTEGER NOT NULL,
        absolute_error INTEGER NOT NULL,
        model_version TEXT NOT NULL DEFAULT 'baseline-v1',
        evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (league, game_id, model_version)
      )
    `);

    const store = createBacktestStore(pool);
    await store.init();

    const report = {
      results: [
        {
          gameId: '401900001',
          gameDate: '2026-10-01T23:00:00.000Z',
          firstHalfTotal: 110,
          predictedSecondHalf: 110,
          actualSecondHalf: 106,
          predictedTotal: 220,
          actualTotal: 216,
          error: 4,
          absoluteError: 4
        },
        {
          gameId: '401900002',
          gameDate: '2026-10-02T23:00:00.000Z',
          firstHalfTotal: 100,
          predictedSecondHalf: 100,
          actualSecondHalf: 106,
          predictedTotal: 200,
          actualTotal: 206,
          error: -6,
          absoluteError: 6
        }
      ]
    };

    const first = await store.saveReport('nba', report);
    assert.equal(first.processedGames, 2);

    const duplicate = await store.saveReport('nba', report);
    assert.equal(duplicate.processedGames, 0);

    const savedGames = await pool.query(`
      SELECT
        game_id,
        game_date,
        model_version
      FROM backtest_results
      WHERE league = $1
      ORDER BY game_id ASC
    `, ['nba']);

    assert.equal(savedGames.rows.length, 2);

    assert.equal(
      savedGames.rows[0].game_id,
      '401900001'
    );

    assert.equal(
      new Date(savedGames.rows[0].game_date).toISOString(),
      '2026-10-01T23:00:00.000Z'
    );

    assert.equal(
      savedGames.rows[1].game_id,
      '401900002'
    );

    assert.equal(
      new Date(savedGames.rows[1].game_date).toISOString(),
      '2026-10-02T23:00:00.000Z'
    );

    assert.equal(
      savedGames.rows[0].model_version,
      'first-half-baseline-v1'
    );

    const accuracy = await store.getAccuracy('nba');

    assert.equal(Number(accuracy.games_tested), 2);
    assert.equal(Number(accuracy.mae), 5);
    assert.equal(Number(accuracy.bias), -1);
    assert.equal(Number(accuracy.rmse), 5.10);
    assert.equal(Number(accuracy.within_5), 50);
    assert.equal(Number(accuracy.within_10), 100);
    assert.equal(Number(accuracy.within_15), 100);

  } finally {
    await pool.end();
  }
});
