
'use strict';

// Basketball Precision Pro — Backtest storage and historical research
// v1 persistence unchanged. v2 and v3 are research-only and walk-forward.
// No sportsbook prices, wagers, or automatic prediction changes.
// v3 rules were chosen after inspecting v2 results: exploratory, not independent.

const MODEL_VERSION = 'first-half-baseline-v1';
const LOCAL_TIMEZONE = 'America/Chicago';

function round(value, places = 2) {
  return Number(Number(value).toFixed(places));
}

function summarizeGames(games) {
  const n = games.length;
  if (n === 0) {
    return {
      games: 0, mae: null, bias: null, rmse: null,
      projectedTooLow: 0, projectedTooHigh: 0, exact: 0,
      thresholds: []
    };
  }

  const errors = games.map(game => Number(game.error));
  const total = values => values.reduce((a, b) => a + b, 0);
  const absoluteErrors = errors.map(Math.abs);
  const exact = errors.filter(error => error === 0).length;

  return {
    games: n,
    mae: round(total(absoluteErrors) / n),
    bias: round(total(errors) / n),
    rmse: round(Math.sqrt(total(errors.map(error => error ** 2)) / n)),
    projectedTooLow: errors.filter(error => error < 0).length,
    projectedTooHigh: errors.filter(error => error > 0).length,
    exact,
    thresholds: [2, 5, 10, 15, 20, 25, 30].map(points => {
      const within = errors.filter(error => Math.abs(error) <= points);
      return {
        points,
        total: within.length,
        percentage: round(100 * within.length / n, 1),
        projectedTooLow: within.filter(error => error < 0).length,
        projectedTooHigh: within.filter(error => error > 0).length,
        exact
      };
    })
  };
}

function firstHalfRange(points) {
  if (points <= 60) return '60 or fewer';
  if (points <= 70) return '61-70';
  if (points <= 80) return '71-80';
  if (points <= 90) return '81-90';
  return '91 or more';
}

const FIRST_HALF_RANGES = [
  '60 or fewer', '61-70', '71-80', '81-90', '91 or more'
];

const WEEKDAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday', 'Sunday'
];

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: LOCAL_TIMEZONE, year: 'numeric',
  month: '2-digit', day: '2-digit'
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LOCAL_TIMEZONE, weekday: 'long'
});

function validDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localDay(value) {
  const date = validDate(value);
  if (!date) return null;
  const parts = dayFormatter.formatToParts(date);
  const read = type => parts.find(part => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function weekdayFromDate(value) {
  const date = validDate(value);
  return date ? weekdayFormatter.format(date) : null;
}

// Every day's predictions are generated before any of that day's
// results enter the training set. Requires 100 older games overall
// AND 20 older games in the matching scoring range. No lookahead
// within the same local date, and no in-sample performance claims.
function walkForwardRegression(games) {
  const byDay = new Map();
  const undated = [];

  for (const game of games) {
    const date = localDay(game.gameDate);
    if (!date) {
      undated.push(game.gameId);
      continue;
    }
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(game);
  }

  const training = new Map(FIRST_HALF_RANGES.map(range => [
    range, { count: 0, sumChange: 0 }
  ]));
  let trainingGames = 0;
  const paired = [];
  const skipped = {
    insufficientOverallHistory: 0,
    insufficientRangeHistory: 0,
    undated: undated.length
  };
  const byRange = new Map(FIRST_HALF_RANGES.map(range => [range, []]));
  const daily = [];

  for (const day of [...byDay.keys()].sort()) {
    const todaysGames = byDay.get(day);
    let eligibleToday = 0;
    const trainingBeforeDay = trainingGames;

    for (const game of todaysGames) {
      const range = firstHalfRange(game.firstHalfTotal);
      const stats = training.get(range);
      if (trainingGames < 100) {
        skipped.insufficientOverallHistory++;
        continue;
      }
      if (stats.count < 20) {
        skipped.insufficientRangeHistory++;
        continue;
      }

      const correction = Math.max(-25, Math.min(25,
        stats.sumChange / stats.count
      ));
      const baselineForecast = game.predictedTotal;
      const v2Forecast = baselineForecast + correction;

      // Research candidate:
      // full adjustment for <=70; half for 71-80; none >=81.
      // This rule was chosen after reviewing the same dataset.
      // Historical v3 scores are NOT independent validation.
      const v3Weight = game.firstHalfTotal <= 70 ? 1
        : game.firstHalfTotal <= 80 ? 0.5 : 0;
      const v3Forecast = baselineForecast + correction * v3Weight;

      const v1Error = baselineForecast - game.actualTotal;
      const v2Error = v2Forecast - game.actualTotal;
      const v3Error = v3Forecast - game.actualTotal;
      const row = {
        gameId: game.gameId,
        day,
        range,
        v1Error,
        v2Error,
        v3Error,
        v3Weight,
        error: v2Error,
        correction,
        trainingRangeGames: stats.count
      };
      paired.push(row);
      byRange.get(range).push(row);
      eligibleToday++;
    }

    daily.push({
      day,
      gamesOnDay: todaysGames.length,
      availablePriorGames: trainingBeforeDay,
      tested: eligibleToday
    });

    // Update only after every game on this date was evaluated.
    for (const game of todaysGames) {
      const stats = training.get(firstHalfRange(game.firstHalfTotal));
      stats.count++;
      stats.sumChange += game.actualSecondHalf - game.firstHalfTotal;
      trainingGames++;
    }
  }

  function modelSummary(rows, errorKey) {
    return summarizeGames(rows.map(row => ({ error: row[errorKey] })));
  }

  const v1 = modelSummary(paired, 'v1Error');
  const v2 = modelSummary(paired, 'v2Error');
  const v3 = modelSummary(paired, 'v3Error');

  const improvement = paired.filter(row =>
    Math.abs(row.v2Error) < Math.abs(row.v1Error)
  ).length;
  const worse = paired.filter(row =>
    Math.abs(row.v2Error) > Math.abs(row.v1Error)
  ).length;
  const v3BetterThanV2 = paired.filter(row =>
    Math.abs(row.v3Error) < Math.abs(row.v2Error) - 1e-9
  ).length;
  const v3WorseThanV2 = paired.filter(row =>
    Math.abs(row.v3Error) > Math.abs(row.v2Error) + 1e-9
  ).length;

  return {
    model: 'scoring-range-regression-v2-experimental',
    status: 'research_only_not_for_betting',
    evaluation: 'walk_forward_by_local_calendar_day',
    trainingRules: {
      minimumPriorGames: 100,
      minimumPriorGamesInRange: 20,
      correctionCapPoints: 25,
      sameDayGamesExcludedFromTraining: true,
      dateIsGameStartNotVerifiedCompletion: true
    },
    coverage: {
      sourceGames: games.length,
      eligiblePairedGames: paired.length,
      excluded: skipped
    },
    v1OnSameGames: v1,
    v2OnSameGames: v2,
    v3OnSameGames: v3,
    selectiveV3: {
      name: 'selective-regression-v3-candidate',
      status: 'retrospective_exploratory_not_independent_validation',
      rules: [
        { firstHalf: '70 or fewer', v2AdjustmentWeight: 1 },
        { firstHalf: '71-80', v2AdjustmentWeight: 0.5 },
        { firstHalf: '81 or more', v2AdjustmentWeight: 0 }
      ],
      note: 'Rules chosen using segment results from this same dataset. ' +
        'Keep fixed and validate on games not included in this report.'
    },
    comparison: {
      maeImprovementPoints: v1.mae === null ? null :
        round(v1.mae - v2.mae),
      rmseImprovementPoints: v1.rmse === null ? null :
        round(v1.rmse - v2.rmse),
      v2BetterAbsoluteErrorGames: improvement,
      v2WorseAbsoluteErrorGames: worse,
      tiedAbsoluteErrorGames: paired.length - improvement - worse,
      v3VersusV2MaeChangePoints: v3.mae === null ? null :
        round(v2.mae - v3.mae),
      v3VersusV1MaeChangePoints: v3.mae === null ? null :
        round(v1.mae - v3.mae),
      v3BetterThanV2Games: v3BetterThanV2,
      v3WorseThanV2Games: v3WorseThanV2,
      v3TiedWithV2Games: paired.length - v3BetterThanV2 - v3WorseThanV2
    },
    byFirstHalfRange: FIRST_HALF_RANGES.map(range => {
      const rows = byRange.get(range);
      return {
        range,
        tested: rows.length,
        v1: modelSummary(rows, 'v1Error'),
        v2: modelSummary(rows, 'v2Error'),
        v3: modelSummary(rows, 'v3Error')
      };
    }),
    days: daily,
    notes: [
      'Historical baseline scores are not archived live halftime predictions.',
      'Same-date observations are never training data for one another.',
      'Earlier start date does not guarantee an earlier completion; validate timing before any live use.',
      'No sportsbook halftime lines or prices are present.',
      'v3 scoring weights were selected after seeing v2 results on these same games.',
      'v3 historical comparison is exploratory; it is not independent validation.',
      'Do not choose v3 over v2 without a new prospective evaluation period.',
      'This research is not a validated profitable wagering system.'
    ]
  };
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
      throw new Error('Backtest results table is missing');
    }
    console.log('Backtest results table ready');
  }

  async function saveReport(league, report, modelVersion = MODEL_VERSION) {
    if (typeof league !== 'string' || !league.trim()) {
      throw new Error('Invalid league');
    }
    if (typeof modelVersion !== 'string' || !modelVersion.trim()) {
      throw new Error('Invalid model version');
    }
    if (!report || !Array.isArray(report.results)) {
      throw new Error('Invalid backtest report');
    }

    let saved = 0;
    for (const game of report.results) {
      const values = [
        game.firstHalfTotal, game.predictedSecondHalf,
        game.actualSecondHalf, game.predictedTotal,
        game.actualTotal, game.error, game.absoluteError
      ].map(Number);

      if (
        !/^\d{5,15}$/.test(String(game.gameId || '')) ||
        !values.every(Number.isFinite)
      ) {
        throw new Error('Invalid backtest game data');
      }

      const insertResult = await pool.query(`
        INSERT INTO backtest_results (
          league, game_id, model_version, game_date,
          first_half_total, predicted_second_half,
          actual_second_half, predicted_total,
          actual_total, error, absolute_error
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (league, game_id, model_version)
        DO NOTHING
      `, [
        league, String(game.gameId), modelVersion,
        game.gameDate ?? null, ...values
      ]);
      saved += insertResult.rowCount;
    }
    return { processedGames: saved };
  }

  async function getAccuracy(league, modelVersion = MODEL_VERSION) {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS games_tested,
        ROUND(AVG(absolute_error), 2) AS mae,
        ROUND(AVG(error), 2) AS bias,
        ROUND(SQRT(AVG(error * error)), 2) AS rmse,
        ROUND(100.0 * AVG(CASE WHEN absolute_error <= 5
          THEN 1 ELSE 0 END), 1) AS within_5,
        ROUND(100.0 * AVG(CASE WHEN absolute_error <= 10
          THEN 1 ELSE 0 END), 1) AS within_10,
        ROUND(100.0 * AVG(CASE WHEN absolute_error <= 15
          THEN 1 ELSE 0 END), 1) AS within_15
      FROM backtest_results
      WHERE league = $1 AND model_version = $2
    `, [league, modelVersion]);
    return result.rows[0];
  }

  async function getHistoricalResearch(league, modelVersion = MODEL_VERSION) {
    if (!['ncaam', 'ncaaw', 'nba', 'wnba'].includes(league)) {
      throw new Error('Unsupported league');
    }

    const [storedResult, testResult] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS total
        FROM games WHERE league = $1 AND status = 'Final'
      `, [league]),
      pool.query(`
        SELECT game_id, game_date, first_half_total,
               actual_second_half, predicted_total, actual_total,
               error, absolute_error
        FROM backtest_results
        WHERE league = $1 AND model_version = $2
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
    })).filter(game => [
      game.firstHalfTotal, game.actualSecondHalf,
      game.predictedTotal, game.actualTotal,
      game.error, game.absoluteError
    ].every(Number.isFinite));

    const totalStored = Number(storedResult.rows[0].total);
    const firstHalfGroups = new Map();
    const weekdayGroups = new Map();

    for (const game of games) {
      const range = firstHalfRange(game.firstHalfTotal);
      if (!firstHalfGroups.has(range)) firstHalfGroups.set(range, []);
      firstHalfGroups.get(range).push(game);

      const weekday = weekdayFromDate(game.gameDate);
      if (weekday) {
        if (!weekdayGroups.has(weekday)) weekdayGroups.set(weekday, []);
        weekdayGroups.get(weekday).push(game);
      }
    }

    const describeGroup = (name, rows) => ({
      group: name,
      ...summarizeGames(rows),
      averageSecondHalfChange: rows.length ? round(
        rows.reduce((sum, game) =>
          sum + game.actualSecondHalf - game.firstHalfTotal, 0
        ) / rows.length
      ) : null
    });

    const firstHalfRanges = FIRST_HALF_RANGES.map(range =>
      describeGroup(range, firstHalfGroups.get(range) || [])
    );
    const weekdays = WEEKDAYS.map(day =>
      describeGroup(day, weekdayGroups.get(day) || [])
    );
    const largestErrors = [...games]
      .sort((a, b) => b.absoluteError - a.absoluteError)
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
        direction: game.error < 0 ? 'projection_too_low'
          : game.error > 0 ? 'projection_too_high' : 'exact'
      }));

    return {
      source: 'PostgreSQL',
      league,
      modelVersion,
      timezone: LOCAL_TIMEZONE,
      readOnly: true,
      coverage: {
        completedGamesStored: totalStored,
        usableBacktests: games.length,
        missingOrUnusable: Math.max(0, totalStored - games.length),
        percentage: totalStored ? round(100 * games.length / totalStored, 1) : 0
      },
      overall: summarizeGames(games),
      firstHalfRanges,
      weekdays,
      largestErrors,
      walkForwardV2: walkForwardRegression(games),
      caveats: [
        'Historical baseline doubles first-half points.',
        'Backtests are not saved real-time forecasts.',
        'No sportsbook odds or halftime lines are included.',
        'Weekday uses game start time in America/Chicago.',
        'Groups are descriptive, not validated betting edges.'
      ]
    };
  }

  return { init, saveReport, getAccuracy, getHistoricalResearch };
}

module.exports = { createBacktestStore };
