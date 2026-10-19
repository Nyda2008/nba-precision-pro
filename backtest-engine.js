
'use strict';

function round(value, places = 2) {
  return Number(value.toFixed(places));
}

function summarize(results) {
  const n = results.length;

  if (n === 0) return null;

  const errors = results.map(
    game => game.error
  );

  const absoluteErrors = results
    .map(game => game.absoluteError)
    .sort((a, b) => a - b);

  const total = values =>
    values.reduce(
      (sum, value) => sum + value,
      0
    );

  const meanAbsoluteError =
    total(absoluteErrors) / n;

  const averageBias =
    total(errors) / n;

  const rootMeanSquaredError = Math.sqrt(
    total(errors.map(error => error ** 2)) / n
  );

  const midpoint = Math.floor(n / 2);

  const medianAbsoluteError = n % 2 === 0
    ? (
        absoluteErrors[midpoint - 1] +
        absoluteErrors[midpoint]
      ) / 2
    : absoluteErrors[midpoint];

  const p90Index = Math.ceil(n * 0.9) - 1;

  const within = limit => round(
    100 * absoluteErrors.filter(
      error => error <= limit
    ).length / n,
    1
  );

  return {
    meanAbsoluteError: round(
      meanAbsoluteError
    ),
    averageBias: round(
      averageBias
    ),
    rootMeanSquaredError: round(
      rootMeanSquaredError
    ),
    within5Points: within(5),
    within10Points: within(10),
    within15Points: within(15),
    medianAbsoluteError: round(
      medianAbsoluteError
    ),
    p90AbsoluteError: round(
      absoluteErrors[p90Index]
    ),
    predictedOver: errors.filter(
      error => error > 0
    ).length,
    predictedUnder: errors.filter(
      error => error < 0
    ).length,
    predictedExactly: errors.filter(
      error => error === 0
    ).length
  };
}

function monthFromDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 7);
}

function backtestGames(games) {
  if (!Array.isArray(games)) {
    throw new Error(
      'Games must be an array'
    );
  }

  const results = [];

  for (const game of games) {
    if (
      !game ||
      game.firstHalfTotal == null ||
      game.secondHalfTotal == null
    ) {
      continue;
    }

    const firstHalf = Number(
      game.firstHalfTotal
    );

    const secondHalf = Number(
      game.secondHalfTotal
    );

    if (
      !Number.isFinite(firstHalf) ||
      !Number.isFinite(secondHalf)
    ) {
      continue;
    }

    const predictedSecondHalf = firstHalf;

    const actualTotal =
      firstHalf + secondHalf;

    const predictedTotal =
      firstHalf * 2;

    const error =
      predictedTotal - actualTotal;

    results.push({
      gameId: game.gameId,
      gameDate: game.gameDate ?? null,
      firstHalfTotal: firstHalf,
      actualSecondHalf: secondHalf,
      predictedSecondHalf,
      predictedTotal,
      actualTotal,
      error,
      absoluteError: Math.abs(error)
    });
  }

  if (results.length === 0) {
    return {
      gamesTested: 0,
      results: [],
      metrics: null,
      monthlyAccuracy: []
    };
  }

  const groups = new Map();

  for (const result of results) {
    const month = monthFromDate(
      result.gameDate
    );

    if (!month) continue;

    if (!groups.has(month)) {
      groups.set(month, []);
    }

    groups.get(month).push(result);
  }

  const monthlyAccuracy = Array.from(
    groups.entries()
  )
    .sort(([a], [b]) =>
      a.localeCompare(b)
    )
    .map(([month, monthResults]) => ({
      month,
      gamesTested: monthResults.length,
      meanAbsoluteError:
        summarize(monthResults).meanAbsoluteError,
      averageBias:
        summarize(monthResults).averageBias
    }));

  return {
    gamesTested: results.length,
    metrics: summarize(results),
    results,
    monthlyAccuracy
  };
}

module.exports = { backtestGames };
