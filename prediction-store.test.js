
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const {
  createPredictionStore
} = require('./prediction-store');

const enabled =
  process.env.CI_TEST_DATABASE === 'true' &&
  Boolean(process.env.DATABASE_URL);

function sampleRecord(gameId, modelVersion = 'experimental-possession-v1') {
  return {
    league: 'nba',
    gameId,
    modelVersion,
    gameStatus: 'halftime',
    observedAt: new Date(
      Date.now() - 60000
    ).toISOString(),
    inputSnapshot: {
      snapshotPeriod: 'halftime',
      teams: [
        {
          name: 'Away Team',
          homeAway: 'away',
          firstHalfPoints: 58
        },
        {
          name: 'Home Team',
          homeAway: 'home',
          firstHalfPoints: 54
        }
      ]
    },
    prediction: {
      modelUsed: modelVersion,
      prediction: {
        projectedSecondHalfTotal: 110,
        projectedFinalTotal: 222,
        projectedSecondHalfResult: {
          winner: 'Away Team',
          signedMargin: 3
        },
        projectedFinalResult: {
          winner: 'Away Team',
          signedMargin: 7
        }
      }
    }
  };
}

test(
  'PostgreSQL halftime prediction storage',
  { skip: !enabled },
  async t => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 10000
    });

    const store = createPredictionStore(pool);
    const gameId = String(Date.now());

    try {
      await t.test('Creates prediction table', async () => {
        await store.init();

        const result = await pool.query(`
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = 'halftime_predictions'
        `);

        assert.equal(result.rowCount, 1);
      });

      await t.test('Saves a halftime prediction', async () => {
        const record = sampleRecord(gameId);

        const result = await store.savePrediction(record);

        assert.equal(result.inserted, true);

        const saved = await store.getPrediction(
          'nba',
          gameId,
          record.modelVersion
        );

        assert.ok(saved);
        assert.equal(saved.game_id, gameId);
        assert.equal(saved.game_status, 'halftime');
        assert.equal(
          saved.prediction.prediction.projectedFinalTotal,
          222
        );
      });

      await t.test('Prevents overwriting original predictions', async () => {
        const record = sampleRecord(gameId);

        record.prediction.prediction.projectedFinalTotal = 999;

        const result = await store.savePrediction(record);

        assert.equal(result.inserted, false);

        const saved = await store.getPrediction(
          'nba',
          gameId,
          record.modelVersion
        );

        assert.equal(
          saved.prediction.prediction.projectedFinalTotal,
          222
        );
      });

      await t.test('Supports separate model versions', async () => {
        const record = sampleRecord(
          gameId,
          'first-half-baseline-v1'
        );

        record.prediction.prediction.projectedSecondHalfTotal = 112;
        record.prediction.prediction.projectedFinalTotal = 224;

        const result = await store.savePrediction(record);

        assert.equal(result.inserted, true);

        const records = await store.getGamePredictions(
          'nba',
          gameId
        );

        assert.equal(records.length, 2);

        const versions = records.map(
          row => row.model_version
        );

        assert.ok(
          versions.includes('experimental-possession-v1')
        );

        assert.ok(
          versions.includes('first-half-baseline-v1')
        );
      });

      await t.test('Rejects non-halftime predictions', async () => {
        const record = sampleRecord(gameId);

        record.gameStatus = 'Final';

        await assert.rejects(
          store.savePrediction(record),
          /Official halftime status required/
        );
      });

      await t.test('Rejects invalid prediction records', async () => {
        const badId = sampleRecord('abc');

        await assert.rejects(
          store.savePrediction(badId),
          /Invalid game ID/
        );

        const mismatched = sampleRecord(gameId);

        mismatched.prediction.modelUsed = 'incorrect-model';

        await assert.rejects(
          store.savePrediction(mismatched),
          /Prediction and model version must match/
        );

        const future = sampleRecord(gameId);

        future.observedAt = new Date(
          Date.now() + 3600000
        ).toISOString();

        await assert.rejects(
          store.savePrediction(future),
          /future/
        );
      });

    } finally {
      try {
        await pool.query(
          'DELETE FROM halftime_predictions WHERE league = $1 AND game_id = $2',
          ['nba', gameId]
        );
      } finally {
        await pool.end();
      }
    }
  }
);
