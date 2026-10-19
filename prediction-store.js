
'use strict';

function createPredictionStore(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('PostgreSQL pool required');
  }

  function requiredText(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Invalid ' + label);
    }
    return value.trim();
  }

  function validDate(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) {
      throw new Error('Invalid observation timestamp');
    }
    if (date.getTime() > Date.now() + 60000) {
      throw new Error('Observation timestamp is in the future');
    }
    return date.toISOString();
  }

  function plainObject(value) {
    return value !== null && typeof value === 'object' &&
      !Array.isArray(value);
  }

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS halftime_predictions (
        id BIGSERIAL PRIMARY KEY,
        league TEXT NOT NULL,
        game_id TEXT NOT NULL,
        model_version TEXT NOT NULL,
        game_status TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        input_snapshot JSONB NOT NULL,
        prediction JSONB NOT NULL,
        UNIQUE (league, game_id, model_version)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS halftime_predictions_lookup
      ON halftime_predictions (league, game_id, observed_at DESC)
    `);
  }

  async function savePrediction(record) {
    if (!plainObject(record)) {
      throw new Error('Invalid prediction record');
    }

    const league = requiredText(record.league, 'league');
    const modelVersion = requiredText(
      record.modelVersion, 'model version'
    );
    const gameId = String(record.gameId ?? '');
    if (!/^\d{5,15}$/.test(gameId)) {
      throw new Error('Invalid game ID');
    }

    if (typeof record.gameStatus !== 'string' ||
        record.gameStatus.trim().toLowerCase() !== 'halftime') {
      throw new Error('Official halftime status required');
    }

    const observedAt = validDate(record.observedAt);
    const input = record.inputSnapshot;
    const prediction = record.prediction;

    if (!plainObject(input) || input.snapshotPeriod !== 'halftime' ||
        !Array.isArray(input.teams) || input.teams.length !== 2) {
      throw new Error('Valid halftime input snapshot required');
    }

    const sides = input.teams.map(team => team && team.homeAway);
    if (!sides.includes('home') || !sides.includes('away')) {
      throw new Error('Home and away inputs required');
    }

    if (!plainObject(prediction) ||
        prediction.modelUsed !== modelVersion ||
        !plainObject(prediction.prediction)) {
      throw new Error('Prediction and model version must match');
    }

    const output = prediction.prediction;
    if (!Number.isFinite(output.projectedSecondHalfTotal) ||
        !Number.isFinite(output.projectedFinalTotal) ||
        !plainObject(output.projectedSecondHalfResult) ||
        !plainObject(output.projectedFinalResult)) {
      throw new Error('Incomplete prediction output');
    }

    // Insert only. Never overwrite an existing game/model prediction.
    const result = await pool.query(`
      INSERT INTO halftime_predictions (
        league, game_id, model_version, game_status,
        observed_at, input_snapshot, prediction
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      ON CONFLICT (league, game_id, model_version) DO NOTHING
      RETURNING id
    `, [
      league, gameId, modelVersion, 'halftime', observedAt,
      JSON.stringify(input), JSON.stringify(prediction)
    ]);

    return { inserted: result.rowCount === 1 };
  }

  async function getPrediction(league, gameId, modelVersion) {
    requiredText(league, 'league');
    requiredText(modelVersion, 'model version');
    if (!/^\d{5,15}$/.test(String(gameId ?? ''))) {
      throw new Error('Invalid game ID');
    }

    const result = await pool.query(`
      SELECT league, game_id, model_version, game_status,
             observed_at, recorded_at, input_snapshot, prediction
      FROM halftime_predictions
      WHERE league = $1 AND game_id = $2 AND model_version = $3
      LIMIT 1
    `, [league, String(gameId), modelVersion]);

    return result.rows[0] || null;
  }

  async function getGamePredictions(league, gameId) {
    requiredText(league, 'league');
    if (!/^\d{5,15}$/.test(String(gameId ?? ''))) {
      throw new Error('Invalid game ID');
    }

    const result = await pool.query(`
      SELECT league, game_id, model_version, game_status,
             observed_at, recorded_at, input_snapshot, prediction
      FROM halftime_predictions
      WHERE league = $1 AND game_id = $2
      ORDER BY observed_at ASC, id ASC
      LIMIT 100
    `, [league, String(gameId)]);

    return result.rows;
  }

  return { init, savePrediction, getPrediction, getGamePredictions };
}

module.exports = { createPredictionStore };
