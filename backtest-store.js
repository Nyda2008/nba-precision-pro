
'use strict';

// Basketball Precision Pro — Backtest storage and research
// Research v4: daily, tipoff-time and recent-game diagnostics.
// Preserves baseline v1, walk-forward v2 and selective v3.
// Read-only research; no changes to live prediction rules.
// Historical forecasts are not archived live predictions.

const MODEL_VERSION = 'first-half-baseline-v1';
const LOCAL_TIMEZONE = 'America/Chicago';

const FIRST_HALF_RANGES = [
  '60 or fewer',
  '61-70',
  '71-80',
  '81-90',
  '91 or more'
];

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

const TIPOFF_WINDOWS = [
  'Before 5 PM',
  '5 PM to 7:59 PM',
  '8 PM or later'
];

const THRESHOLDS = [2, 5, 10, 15, 20, 25, 30];

function round(value, places = 2) {
  return Number(Number(value).toFixed(places));
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) /
        values.length
    : null;
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

  // Error = predicted total minus actual total.
  // Negative means actual scoring exceeded projection.
  const errors = games.map(game => Number(game.error));
  const absoluteErrors = errors.map(Math.abs);
  const exact = errors.filter(error => error === 0).length;

  return {
    games: n,
    mae: round(average(absoluteErrors)),
    bias: round(average(errors)),
    rmse: round(Math.sqrt(average(
      errors.map(error => error ** 2)
    ))),
    projectedTooLow:
      errors.filter(error => error < 0).length,
    projectedTooHigh:
      errors.filter(error => error > 0).length,
    exact,
    thresholds: THRESHOLDS.map(points => {
      const within = errors.filter(error =>
        Math.abs(error) <= points
      );

      return {
        points,
        total: within.length,
        percentage: round(
          100 * within.length / n,
          1
        ),
        projectedTooLow:
          within.filter(error => error < 0).length,
        projectedTooHigh:
          within.filter(error => error > 0).length,
        exact
      };
    })
  };
}

function directionResearch(games) {
  const n = games.length;
  const tooLow = games
    .map(game => Number(game.error))
    .filter(error => error < 0);
  const tooHigh = games
    .map(game => Number(game.error))
    .filter(error => error > 0);

  return {
    games: n,
    finishedAboveProjection: tooLow.length,
    finishedBelowProjection: tooHigh.length,
    exactlyOnProjection: n - tooLow.length -
      tooHigh.length,
    percentageAboveProjection: n
      ? round(100 * tooLow.length / n, 1)
      : null,
    percentageBelowProjection: n
      ? round(100 * tooHigh.length / n, 1)
      : null,
    averagePointsAboveProjection: tooLow.length
      ? round(average(tooLow.map(error => -error)))
      : null,
    averagePointsBelowProjection: tooHigh.length
      ? round(average(tooHigh))
      : null,
    errorDistribution: [
      { label: '1 to 2 points', min: 1, max: 2 },
      { label: '3 to 4 points', min: 3, max: 4 },
      { label: '5 to 7 points', min: 5, max: 7 },
      { label: '8 to 10 points', min: 8, max: 10 },
      { label: '11 to 15 points', min: 11, max: 15 },
      { label: '16 to 20 points', min: 16, max: 20 },
      { label: '21 or more points', min: 21, max: Infinity }
    ].map(bin => {
      const above = tooLow.filter(error =>
        -error >= bin.min && -error <= bin.max
      ).length;

      const below = tooHigh.filter(error =>
        error >= bin.min && error <= bin.max
      ).length;

      return {
        range: bin.label,
        aboveProjectionGames: above,
        aboveProjectionPercentageOfAll: n
          ? round(100 * above / n, 1)
          : null,
        belowProjectionGames: below,
        belowProjectionPercentageOfAll: n
          ? round(100 * below / n, 1)
          : null
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

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: LOCAL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LOCAL_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23'
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LOCAL_TIMEZONE,
  weekday: 'long'
});

function validDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localDay(value) {
  const date = validDate(value);
  if (!date) return null;

  const parts = dayFormatter.formatToParts(date);
  const read = type =>
    parts.find(part => part.type === type)?.value;

  return [
    read('year'),
    read('month'),
    read('day')
  ].join('-');
}

function localClock(value) {
  const date = validDate(value);
  if (!date) return null;

  const parts = timeFormatter.formatToParts(date);
  const hour = parts.find(part =>
    part.type === 'hour'
  )?.value;

  const minute = parts.find(part =>
    part.type === 'minute'
  )?.value;

  if (!hour || !minute) return null;
  return `${hour === '24' ? '00' : hour}:${minute}`;
}

function localHour(value) {
  const clock = localClock(value);
  return clock ? Number(clock.slice(0, 2)) : null;
}

function tipoffWindow(value) {
  const hour = localHour(value);

  if (hour === null) return 'Unknown';
  if (hour < 17) return 'Before 5 PM';
  if (hour < 20) return '5 PM to 7:59 PM';
  return '8 PM or later';
}

function weekdayFromDate(value) {
  const date = validDate(value);
  return date ? weekdayFormatter.format(date) : null;
}

function recentLocalDays() {
  const now = new Date();

  return [
    localDay(new Date(now.getTime() - 86400000)),
    localDay(now)
  ].filter(Boolean);
}

function describeGroup(name, rows) {
  return {
    group: name,
    ...summarizeGames(rows),
    averageSecondHalfChange: rows.length
      ? round(average(rows.map(game =>
          game.actualSecondHalf - game.firstHalfTotal
        )))
      : null,
    direction: directionResearch(rows)
  };
}

function modelSummary(rows, errorKey) {
  const errors = rows.map(row => ({
    error: row[errorKey]
  }));

  return {
    ...summarizeGames(errors),
    direction: directionResearch(errors)
  };
}

function modelComparison(rows) {
  return {
    games: rows.length,
    v1: modelSummary(rows, 'v1Error'),
    v2: modelSummary(rows, 'v2Error'),
    v3: modelSummary(rows, 'v3Error'),
    averageFirstHalfPoints: rows.length
      ? round(average(rows.map(row =>
          row.firstHalfTotal
        )))
      : null,
    averageActualSecondHalfPoints: rows.length
      ? round(average(rows.map(row =>
          row.actualSecondHalf
        )))
      : null
  };
}

// Walk-forward model: training data are drawn only from
// games with earlier local calendar dates.
// At least 100 prior games overall and 20 in the range.
// This is not proof that results were available in real time.
function walkForwardRegression(games) {
  const byDay = new Map();
  const undated = [];

  for (const game of games) {
    const day = localDay(game.gameDate);

    if (!day) {
      undated.push(game.gameId);
      continue;
    }

    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(game);
  }

  const training = new Map(
    FIRST_HALF_RANGES.map(range => [
      range,
      { count: 0, sumChange: 0 }
    ])
  );

  let trainingGames = 0;
  const paired = [];

  const skipped = {
    insufficientOverallHistory: 0,
    insufficientRangeHistory: 0,
    undated: undated.length
  };

  const byRange = new Map(
    FIRST_HALF_RANGES.map(range => [range, []])
  );

  const daily = [];

  for (const day of [...byDay.keys()].sort()) {
    const todaysGames = byDay.get(day);
    const trainingBeforeDay = trainingGames;
    let eligibleToday = 0;

    for (const game of todaysGames) {
      const range = firstHalfRange(
        game.firstHalfTotal
      );

      const stats = training.get(range);

      if (trainingGames < 100) {
        skipped.insufficientOverallHistory++;
        continue;
      }

      if (stats.count < 20) {
        skipped.insufficientRangeHistory++;
        continue;
      }

      const correction = Math.max(
        -25,
        Math.min(
          25,
          stats.sumChange / stats.count
        )
      );

      const baselineForecast = game.predictedTotal;
      const v2Forecast = baselineForecast + correction;

      // v3 remains unchanged:
      // <=70: 100% correction
      // 71-80: 50% correction
      // >=81: no correction
      const v3Weight = game.firstHalfTotal <= 70
        ? 1
        : game.firstHalfTotal <= 80
          ? 0.5
          : 0;

      const v3Forecast =
        baselineForecast + correction * v3Weight;

      const row = {
        gameId: game.gameId,
        gameDate: game.gameDate,
        day,
        localTipoff: localClock(game.gameDate),
        tipoffWindow: tipoffWindow(game.gameDate),
        firstHalfTotal: game.firstHalfTotal,
        actualSecondHalf: game.actualSecondHalf,
        actualTotal: game.actualTotal,
        range,
        v1ProjectedSecondHalf:
          baselineForecast - game.firstHalfTotal,
        v2ProjectedSecondHalf:
          v2Forecast - game.firstHalfTotal,
        v3ProjectedSecondHalf:
          v3Forecast - game.firstHalfTotal,
        v1Error: baselineForecast - game.actualTotal,
        v2Error: v2Forecast - game.actualTotal,
        v3Error: v3Forecast - game.actualTotal,
        v3Weight,
        error: v2Forecast - game.actualTotal,
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

    // No games from today's date enter today's training.
    for (const game of todaysGames) {
      const stats = training.get(
        firstHalfRange(game.firstHalfTotal)
      );

      stats.count++;
      stats.sumChange +=
        game.actualSecondHalf - game.firstHalfTotal;

      trainingGames++;
    }
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
    Math.abs(row.v3Error) <
      Math.abs(row.v2Error) - 1e-9
  ).length;

  const v3WorseThanV2 = paired.filter(row =>
    Math.abs(row.v3Error) >
      Math.abs(row.v2Error) + 1e-9
  ).length;

  const pairedByDay = new Map();
  const pairedByWindow = new Map();

  for (const row of paired) {
    if (!pairedByDay.has(row.day)) {
      pairedByDay.set(row.day, []);
    }
    pairedByDay.get(row.day).push(row);

    if (!pairedByWindow.has(row.tipoffWindow)) {
      pairedByWindow.set(row.tipoffWindow, []);
    }
    pairedByWindow.get(row.tipoffWindow).push(row);
  }

  const dailyAccuracy = [...byDay.keys()]
    .sort()
    .map(day => ({
      day,
      ...modelComparison(pairedByDay.get(day) || []),
      tipoffWindows: TIPOFF_WINDOWS.map(window => ({
        window,
        ...modelComparison(
          (pairedByDay.get(day) || []).filter(row =>
            row.tipoffWindow === window
          )
        )
      }))
    }));

  const tipoffAccuracy = TIPOFF_WINDOWS.map(window => ({
    window,
    ...modelComparison(pairedByWindow.get(window) || []),
    byFirstHalfRange: FIRST_HALF_RANGES.map(range => ({
      range,
      ...modelComparison(
        (pairedByWindow.get(window) || []).filter(row =>
          row.range === range
        )
      )
    }))
  }));

  const recentDays = new Set(recentLocalDays());

  const recentGamePredictions = paired
    .filter(row => recentDays.has(row.day))
    .sort((a, b) =>
      String(a.gameDate).localeCompare(
        String(b.gameDate)
      )
    )
    .map(row => ({
      gameId: row.gameId,
      gameDate: row.gameDate,
      day: row.day,
      localTipoff: row.localTipoff,
      tipoffWindow: row.tipoffWindow,
      firstHalfTotal: row.firstHalfTotal,
      actualSecondHalf: row.actualSecondHalf,
      actualTotal: row.actualTotal,
      v1ProjectedSecondHalf: round(
        row.v1ProjectedSecondHalf
      ),
      v2ProjectedSecondHalf: round(
        row.v2ProjectedSecondHalf
      ),
      v3ProjectedSecondHalf: round(
        row.v3ProjectedSecondHalf
      ),
      v1Error: round(row.v1Error),
      v2Error: round(row.v2Error),
      v3Error: round(row.v3Error),
      scoringRange: row.range,
      correctionAppliedByV2: round(row.correction)
    }));

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
      status:
        'retrospective_exploratory_not_independent_validation',
      rules: [
        {
          firstHalf: '70 or fewer',
          v2AdjustmentWeight: 1
        },
        {
          firstHalf: '71-80',
          v2AdjustmentWeight: 0.5
        },
        {
          firstHalf: '81 or more',
          v2AdjustmentWeight: 0
        }
      ],
      note:
        'Rules selected using the same historical dataset. ' +
        'Validate without further tuning on new games.'
    },

    comparison: {
      maeImprovementPoints: v1.mae === null
        ? null
        : round(v1.mae - v2.mae),

      rmseImprovementPoints: v1.rmse === null
        ? null
        : round(v1.rmse - v2.rmse),

      v2BetterAbsoluteErrorGames: improvement,
      v2WorseAbsoluteErrorGames: worse,
      tiedAbsoluteErrorGames:
        paired.length - improvement - worse,

      v3VersusV2MaeChangePoints: v3.mae === null
        ? null
        : round(v2.mae - v3.mae),

      v3VersusV1MaeChangePoints: v3.mae === null
        ? null
        : round(v1.mae - v3.mae),

      v3BetterThanV2Games: v3BetterThanV2,
      v3WorseThanV2Games: v3WorseThanV2,
      v3TiedWithV2Games:
        paired.length -
        v3BetterThanV2 -
        v3WorseThanV2
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

    dailyAccuracy,
    tipoffAccuracy,
    recentGamePredictions,

    notes: [
      'Historical baseline scores are not archived live halftime predictions.',
      'Same-date observations are never training data for one another.',
      'Earlier start date does not guarantee an earlier completion.',
      'No sportsbook halftime lines or prices are present.',
      'v3 rules were selected after examining these historical results.',
      'Tipoff groups describe associations, not causal time-of-day effects.',
      'Recent game predictions are reconstructed historical forecasts.',
      'These results do not establish a profitable wagering system.'
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

  async function saveReport(
    league,
    report,
    modelVersion = MODEL_VERSION
  ) {
    if (
      typeof league !== 'string' ||
      !league.trim()
    ) {
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
        ON CONFLICT (
          league,
          game_id,
          model_version
        )
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
        ROUND(
          SQRT(AVG(error * error)),
          2
        ) AS rmse,
        ROUND(
          100.0 * AVG(
            CASE WHEN absolute_error <= 5
              THEN 1 ELSE 0 END
          ),
          1
        ) AS within_5,
        ROUND(
          100.0 * AVG(
            CASE WHEN absolute_error <= 10
              THEN 1 ELSE 0 END
          ),
          1
        ) AS within_10,
        ROUND(
          100.0 * AVG(
            CASE WHEN absolute_error <= 15
              THEN 1 ELSE 0 END
          ),
          1
        ) AS within_15
      FROM backtest_results
      WHERE league = $1
        AND model_version = $2
    `, [league, modelVersion]);

    return result.rows[0];
  }

  async function getHistoricalResearch(
    league,
    modelVersion = MODEL_VERSION
  ) {
    if (
      !['ncaam', 'ncaaw', 'nba', 'wnba'].includes(league)
    ) {
      throw new Error('Unsupported league');
    }

    const [storedResult, testResult, recentStoredResult] =
      await Promise.all([
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
        `, [league, modelVersion]),

        pool.query(`
          SELECT
            g.game_id,
            g.game_date,
            CASE
              WHEN b.game_id IS NULL
                THEN false
              ELSE true
            END AS has_backtest
          FROM games g
          LEFT JOIN backtest_results b
            ON b.league = g.league
           AND b.game_id = g.game_id
           AND b.model_version = $2
          WHERE g.league = $1
            AND g.status = 'Final'
          ORDER BY g.game_date DESC, g.game_id DESC
          LIMIT 250
        `, [league, modelVersion])
      ]);

    const games = testResult.rows
      .map(row => ({
        gameId: String(row.game_id),
        gameDate: row.game_date,
        firstHalfTotal:
          Number(row.first_half_total),
        actualSecondHalf:
          Number(row.actual_second_half),
        predictedTotal:
          Number(row.predicted_total),
        actualTotal:
          Number(row.actual_total),
        error: Number(row.error),
        absoluteError:
          Number(row.absolute_error)
      }))
      .filter(game => [
        game.firstHalfTotal,
        game.actualSecondHalf,
        game.predictedTotal,
        game.actualTotal,
        game.error,
        game.absoluteError
      ].every(Number.isFinite));

    const totalStored =
      Number(storedResult.rows[0].total);

    const firstHalfGroups = new Map();
    const weekdayGroups = new Map();
    const dailyGroups = new Map();
    const tipoffGroups = new Map();

    for (const game of games) {
      const range = firstHalfRange(
        game.firstHalfTotal
      );

      if (!firstHalfGroups.has(range)) {
        firstHalfGroups.set(range, []);
      }

      firstHalfGroups.get(range).push(game);

      const weekday = weekdayFromDate(
        game.gameDate
      );

      if (weekday) {
        if (!weekdayGroups.has(weekday)) {
          weekdayGroups.set(weekday, []);
        }

        weekdayGroups.get(weekday).push(game);
      }

      const day = localDay(game.gameDate);

      if (day) {
        if (!dailyGroups.has(day)) {
          dailyGroups.set(day, []);
        }

        dailyGroups.get(day).push(game);
      }

      const window = tipoffWindow(game.gameDate);

      if (!tipoffGroups.has(window)) {
        tipoffGroups.set(window, []);
      }

      tipoffGroups.get(window).push(game);
    }

    const firstHalfRanges =
      FIRST_HALF_RANGES.map(range =>
        describeGroup(
          range,
          firstHalfGroups.get(range) || []
        )
      );

    const weekdays = WEEKDAYS.map(day =>
      describeGroup(
        day,
        weekdayGroups.get(day) || []
      )
    );

    const dailyBaselineAccuracy = [
      ...dailyGroups.keys()
    ].sort().map(day => ({
      day,
      ...describeGroup(
        day,
        dailyGroups.get(day)
      ),
      tipoffWindows: TIPOFF_WINDOWS.map(window =>
        describeGroup(
          window,
          dailyGroups.get(day).filter(game =>
            tipoffWindow(game.gameDate) === window
          )
        )
      )
    }));

    const baselineTipoffAccuracy =
      TIPOFF_WINDOWS.map(window => ({
        window,
        ...describeGroup(
          window,
          tipoffGroups.get(window) || []
        ),
        byFirstHalfRange: FIRST_HALF_RANGES.map(range =>
          describeGroup(
            range,
            (tipoffGroups.get(window) || []).filter(
              game => firstHalfRange(
                game.firstHalfTotal
              ) === range
            )
          )
        )
      }));

    const recentDays = new Set(recentLocalDays());

    const recentBaselineGames = games
      .filter(game =>
        recentDays.has(localDay(game.gameDate))
      )
      .sort((a, b) =>
        new Date(a.gameDate) - new Date(b.gameDate)
      )
      .map(game => ({
        gameId: game.gameId,
        gameDate: game.gameDate,
        day: localDay(game.gameDate),
        localTipoff: localClock(game.gameDate),
        tipoffWindow: tipoffWindow(game.gameDate),
        firstHalfTotal: game.firstHalfTotal,
        v1ProjectedSecondHalf: round(
          game.predictedTotal - game.firstHalfTotal
        ),
        actualSecondHalf: game.actualSecondHalf,
        predictedTotal: game.predictedTotal,
        actualTotal: game.actualTotal,
        error: round(game.error),
        absoluteError: round(game.absoluteError),
        direction: game.error < 0
          ? 'projection_too_low'
          : game.error > 0
            ? 'projection_too_high'
            : 'exact'
      }));

    const recentCompletedGames =
      recentStoredResult.rows
        .filter(row =>
          recentDays.has(localDay(row.game_date))
        )
        .map(row => ({
          gameId: String(row.game_id),
          gameDate: row.game_date,
          day: localDay(row.game_date),
          localTipoff: localClock(row.game_date),
          tipoffWindow: tipoffWindow(row.game_date),
          hasSavedBaselineBacktest:
            row.has_backtest === true
        }))
        .sort((a, b) =>
          String(a.gameDate).localeCompare(
            String(b.gameDate)
          )
        );

    const recentCoverage = [...recentDays]
      .sort()
      .map(day => {
        const rows = recentCompletedGames.filter(
          game => game.day === day
        );

        const saved = rows.filter(
          game => game.hasSavedBaselineBacktest
        );

        return {
          day,
          completedGames: rows.length,
          withSavedBaselineBacktest: saved.length,
          missingBaselineBacktest:
            rows.length - saved.length,
          missingGameIds: rows
            .filter(game =>
              !game.hasSavedBaselineBacktest
            )
            .map(game => game.gameId)
        };
      });

    const largestErrors = [...games]
      .sort((a, b) =>
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
      timezone: LOCAL_TIMEZONE,
      readOnly: true,
      researchVersion:
        'daily-and-tipoff-accuracy-v4',

      coverage: {
        completedGamesStored: totalStored,
        usableBacktests: games.length,
        missingOrUnusable: Math.max(
          0,
          totalStored - games.length
        ),
        percentage: totalStored
          ? round(
              100 * games.length / totalStored,
              1
            )
          : 0
      },

      overall: summarizeGames(games),
      overallDirection: directionResearch(games),
      firstHalfRanges,
      weekdays,
      largestErrors,

      dailyBaselineAccuracy,
      baselineTipoffAccuracy,
      recentBaselineGames,
      recentCoverage,
      recentCompletedGames,

      walkForwardV2: walkForwardRegression(games),

      caveats: [
        'Historical baseline doubles first-half points.',
        'Backtests are not saved real-time forecasts.',
        'No sportsbook odds or halftime lines are included.',
        'Weekday and tipoff windows use America/Chicago.',
        'Recent completed-game coverage is limited to the latest 250 stored final games.',
        'A saved backtest may still be excluded if its values are unusable.',
        'Walk-forward v2 and v3 are historical reconstructed forecasts.',
        'v3 rules were selected using the historical development sample.',
        'Tipoff-time groups do not demonstrate causation.',
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
