
'use strict';

// Basketball Precision Pro
// Daily NCAA Men's Basketball Analytics v1
// Read-only scoring calculations.
// All games must already be filtered by Central Time date.
// Overtime games are excluded from regulation comparisons.

const SCORING_BANDS = [
  { label: '60 or fewer', min: 0, max: 60 },
  { label: '61-70', min: 61, max: 70 },
  { label: '71-80', min: 71, max: 80 },
  { label: '81-90', min: 81, max: 90 },
  { label: '91 or more', min: 91, max: Infinity }
];

function round(value) {
  return Math.round(value * 100) / 100;
}

function average(rows, field) {
  if (!rows.length) return null;
  return round(
    rows.reduce((sum, row) => sum + row[field], 0) /
    rows.length
  );
}

function percentage(count, total) {
  return total ? round((count / total) * 100) : null;
}

function summarize(rows) {
  const total = rows.length;

  const increased = rows.filter(
    game => game.secondHalfChange > 0
  ).length;

  const decreased = rows.filter(
    game => game.secondHalfChange < 0
  ).length;

  const equal = total - increased - decreased;

  return {
    games: total,
    averageFirstHalf: average(rows, 'firstHalfTotal'),
    averageSecondHalf: average(rows, 'secondHalfTotal'),
    averageFinalTotal: average(rows, 'finalTotal'),
    averageSecondHalfChange:
      average(rows, 'secondHalfChange'),

    increased,
    increasedPercentage: percentage(increased, total),
    decreased,
    decreasedPercentage: percentage(decreased, total),
    equal,
    equalPercentage: percentage(equal, total),

    meanAbsoluteError: average(rows, 'absoluteError'),
    averageBias: average(rows, 'error'),

    within5Points: percentage(
      rows.filter(g => g.absoluteError <= 5).length,
      total
    ),
    within10Points: percentage(
      rows.filter(g => g.absoluteError <= 10).length,
      total
    ),
    within15Points: percentage(
      rows.filter(g => g.absoluteError <= 15).length,
      total
    )
  };
}

function analyzeDailyGames(games, date) {
  if (!Array.isArray(games)) {
    throw new Error('Games must be an array');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error('Valid report date required');
  }

  const evaluated = [];
  const skipped = [];
  const seen = new Set();

  for (const game of games) {
    const id = String(game.gameId || '');

    if (!id || seen.has(id)) {
      skipped.push({
        gameId: id,
        reason: 'Missing or duplicate game ID'
      });
      continue;
    }

    seen.add(id);

    const first = Number(game.firstHalfTotal);
    const second = Number(game.secondHalfTotal);
    const final = Number(game.finalTotal);

    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(second) ||
      !Number.isSafeInteger(final) ||
      first < 0 || second < 0 ||
      final !== first + second ||
      game.overtime === true
    ) {
      skipped.push({
        gameId: id,
        reason: 'Invalid regulation scoring or overtime'
      });
      continue;
    }

    const projectedTotal = first * 2;
    const error = projectedTotal - final;

    evaluated.push({
      gameId: id,
      name: game.name || null,
      firstHalfTotal: first,
      secondHalfTotal: second,
      finalTotal: final,
      secondHalfChange: second - first,
      projectedTotal,
      error,
      absoluteError: Math.abs(error)
    });
  }

  const scoringBands = SCORING_BANDS.map(band => {
    const matching = evaluated.filter(game =>
      game.firstHalfTotal >= band.min &&
      game.firstHalfTotal <= band.max
    );

    return {
      range: band.label,
      shareOfGames: percentage(
        matching.length, evaluated.length
      ),
      ...summarize(matching)
    };
  });

  return {
    league: 'ncaam',
    date,
    timezone: 'America/Chicago',
    model: 'first-half-baseline-v1',
    reportType: 'retrospective-backtest',
    note: 'Not verified live predictions',
    gamesSelected: games.length,
    gamesEvaluated: evaluated.length,
    skipped,
    overall: summarize(evaluated),
    scoringBands,
    games: evaluated
  };
}

module.exports = {
  analyzeDailyGames,
  SCORING_BANDS
};
