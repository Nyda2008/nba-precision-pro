
'use strict';

// Basketball Precision Pro
// Backtest storage and historical research
// Preserves existing backtest functions.
// Historical research is read-only.

const MODEL_VERSION = 'first-half-baseline-v1';

function round(value, places = 2) {
  return Number(Number(value).toFixed(places));
}

function summarizeGames(games) {
  const n = games.length;

  if (n === 0) {
    return {
      games: 0,
      mae: null,
      bias: null,
      rmse: null,
      projectedTooLow: 0,
      projectedTooHigh: 0,
      exact: 0,
      thresholds: []
    };
  }

  const errors = games.map(g => Number(g.error));
  const absoluteErrors = errors.map(Math.abs);

  const sum = values =>
    values.reduce((total, value) => total + value, 0);

  const below = errors.filter(e => e < 0).length;
  const above = errors.filter(e => e > 0).length;
  const exact = errors.filter(e => e === 0).length;

  const thresholds = [2, 5, 10, 15, 20, 25, 30].map(
    threshold => {
      const within = errors.filter(
        e => Math.abs(e) <= threshold
      );

      return {
        points: threshold,
        total: within.length,
        percentage: round(100 * within.length / n, 1),
        projectedTooLow: within.filter(
          e => e < 0
        ).length,
        projectedTooHigh: within.filter(
          e => e > 0
        ).length,
        exact
      };
    }
  );

  return {
    games: n,
    mae: round(sum(absoluteErrors) / n),
    bias: round(sum(errors) / n),
    rmse: round(Math.sqrt(
      sum(errors.map(e => e * e)) / n
    )),
    projectedTooLow: below,
    projectedTooHigh: above,
    exact,
    thresholds
  };
}

function firstHalfRange(points) {
  if (points <= 60) return '60 or fewer';
  if (points <= 70) return '61-70';
  if (points <= 80) return '71-80';
  if (points <= 90) return '81-90';
  return '91 or more';
}

function weekdayFromDate(value) {
  if (!value) return null;

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long'
  }).format(date);
}

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
    modelVersion = MODEL_VERSION
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
    modelVersion = MODEL_VERSION
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

  // Reads all previously saved backtests.
  // Does not insert, update, delete or place bets.

  async function getHistoricalResearch(
    league,
    modelVersion = MODEL_VERSION
  ) {
    if (
      !['ncaam', 'ncaaw', 'nba', 'wnba'].includes(league)
    ) {
      throw new Error('Unsupported league');
    }

    const [storedResult, testResult] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS total
        FROM games
        WHERE league = $1
          AND status = 'Final'
      `, [league]),

      pool.query(`
        SELECT
          game_id,
          game_date,
          first_half_total,
          actual_second_half,
          predicted_total,
          actual_total,
          error,
          absolute_error
        FROM backtest_results
        WHERE league = $1
          AND model_version = $2
        ORDER BY game_date, game_id
      `, [league, modelVersion])
    ]);

    const games = testResult.rows.map(row => ({
      gameId: String(row.game_id),
      gameDate: row.game_date,
      firstHalfTotal: Number(row.first_half_total),
      actualSecondHalf: Number(row.actual_second_half),
      predictedTotal: Number(row.predicted_total),
      actualTotal: Number(row.actual_total),
      error: Number(row.error),
      absoluteError: Number(row.absolute_error)
    })).filter(game =>
      [
        game.firstHalfTotal,
        game.actualSecondHalf,
        game.predictedTotal,
        game.actualTotal,
        game.error,
        game.absoluteError
      ].every(Number.isFinite)
    );

    const totalStored = Number(
      storedResult.rows[0].total
    );

    const groupedFirstHalf = new Map();
    const groupedWeekdays = new Map();

    for (const game of games) {
      const range = firstHalfRange(game.firstHalfTotal);

      if (!groupedFirstHalf.has(range)) {
        groupedFirstHalf.set(range, []);
      }

      groupedFirstHalf.get(range).push(game);

      const weekday = weekdayFromDate(game.gameDate);

      if (weekday) {
        if (!groupedWeekdays.has(weekday)) {
          groupedWeekdays.set(weekday, []);
        }

        groupedWeekdays.get(weekday).push(game);
      }
    }

    const firstHalfOrder = [
      '60 or fewer',
      '61-70',
      '71-80',
      '81-90',
      '91 or more'
    ];

    const weekdayOrder = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday'
    ];

    const describeGroup = (name, rows) => ({
      group: name,
      ...summarizeGames(rows),
      averageSecondHalfChange: rows.length
        ? round(
          rows.reduce(
            (total, game) =>
              total +
              game.actualSecondHalf -
              game.firstHalfTotal,
            0
          ) / rows.length
        )
        : null
    });

    const firstHalfRanges = firstHalfOrder.map(
      range => describeGroup(
        range,
        groupedFirstHalf.get(range) || []
      )
    );

    const weekdays = weekdayOrder.map(
      day => describeGroup(
        day,
        groupedWeekdays.get(day) || []
      )
    );

    const largestErrors = [...games]
      .sort(
        (a, b) =>
          b.absoluteError - a.absoluteError
      )
      .slice(0, 15)
      .map(game => ({
        gameId: game.gameId,
        gameDate: game.gameDate,
        firstHalfTotal: game.firstHalfTotal,
        actualSecondHalf: game.actualSecondHalf,
        predictedTotal: game.predictedTotal,
        actualTotal: game.actualTotal,
        error: game.error,
        absoluteError: game.absoluteError,
        direction: game.error < 0
          ? 'projection_too_low'
          : game.error > 0
            ? 'projection_too_high'
            : 'exact'
      }));

    return {
      source: 'PostgreSQL',
      league,
      modelVersion,
      timezone: 'America/Chicago',
      readOnly: true,
      coverage: {
        completedGamesStored: totalStored,
        usableBacktests: games.length,
        missingOrUnusable: Math.max(
          0,
          totalStored - games.length
        ),
        percentage: totalStored
          ? round(100 * games.length / totalStored, 1)
          : 0
      },
      overall: summarizeGames(games),
      firstHalfRanges,
      weekdays,
      largestErrors,
      caveats: [
        'Historical baseline doubles first-half points.',
        'Backtests are not saved real-time forecasts.',
        'No sportsbook odds or halftime lines are included.',
        'Weekday uses game start time in America/Chicago.',
        'Groups are descriptive, not validated betting edges.'
      ]
    };
  }

  return {
    init,
    saveReport,
    getAccuracy,
    getHistoricalResearch
  };
}

module.exports = { createBacktestStore };
