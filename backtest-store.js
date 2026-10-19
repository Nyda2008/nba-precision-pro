'use strict';

function createBacktestStore(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('PostgreSQL pool required');
  }

  async function init() {
    const result = await pool.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'backtest_results'
    `);

    if (result.rows.length === 0) {
      throw new Error(
        'Backtest results table is missing'
      );
    }

    console.log('Backtest results table ready');
  }

  async function saveReport(
    league,
    report,
    modelVersion = 'first-half-baseline-v1'
  ) {
    if (typeof league !== 'string' || !league.trim()) {
      throw new Error('Invalid league');
    }

    if (
      typeof modelVersion !== 'string' ||
      !modelVersion.trim()
    ) {
      throw new Error('Invalid model version');
    }

    if (!report || !Array.isArray(report.results)) {
      throw new Error('Invalid backtest report');
    }

    let saved = 0;

    for (const game of report.results) {
      const values = [
        game.firstHalfTotal,
        game.predictedSecondHalf,
        game.actualSecondHalf,
        game.predictedTotal,
        game.actualTotal,
        game.error,
        game.absoluteError
      ].map(Number);

      if (
        !/^\d{5,15}$/.test(String(game.gameId || '')) ||
        !values.every(Number.isFinite)
      ) {
        throw new Error('Invalid backtest game data');
      }

      const insertResult = await pool.query(`
        INSERT INTO backtest_results (
          league,
          game_id,
          model_version,
          game_date,
          first_half_total,
          predicted_second_half,
          actual_second_half,
          predicted_total,
          actual_total,
          error,
          absolute_error
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11
        )
        ON CONFLICT (league, game_id, model_version)
        DO NOTHING
      `, [
        league,
        String(game.gameId),
        modelVersion,
        game.gameDate ?? null,
        ...values
      ]);

      saved += insertResult.rowCount;
    }

    return { processedGames: saved };
  }

  async function getAccuracy(
    league,
    modelVersion = 'first-half-baseline-v1'
  ) {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS games_tested,
        ROUND(AVG(absolute_error), 2) AS mae,
        ROUND(AVG(error), 2) AS bias,
        ROUND(SQRT(AVG(error * error)), 2) AS rmse,
        ROUND(
          100.0 * AVG(
            CASE WHEN absolute_error <= 5
            THEN 1 ELSE 0 END
          ), 1
        ) AS within_5,
        ROUND(
          100.0 * AVG(
            CASE WHEN absolute_error <= 10
            THEN 1 ELSE 0 END
          ), 1
        ) AS within_10,
        ROUND(
          100.0 * AVG(
            CASE WHEN absolute_error <= 15
            THEN 1 ELSE 0 END
          ), 1
        ) AS within_15
      FROM backtest_results
      WHERE league = $1
        AND model_version = $2
    `, [league, modelVersion]);

    return result.rows[0];
  }

  return {
    init,
    saveReport,
    getAccuracy
  };
}

module.exports = { createBacktestStore };
