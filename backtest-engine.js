
'use strict';

function backtestGames(games) {
  if (!Array.isArray(games)) {
    throw new Error('Games must be an array');
  }

  const results = [];

  for (const game of games) {
    const firstHalf = Number(game.firstHalfTotal);
    const secondHalf = Number(game.secondHalfTotal);

    if (
      game.firstHalfTotal == null ||
      game.secondHalfTotal == null ||
      !Number.isFinite(firstHalf) ||
      !Number.isFinite(secondHalf)
    ) {
      continue;
    }

    const predictedSecondHalf = firstHalf;
    const actualTotal = firstHalf + secondHalf;
    const predictedTotal = firstHalf * 2;
    const error = predictedTotal - actualTotal;

    results.push({
      gameId: game.gameId,
      firstHalfTotal: firstHalf,
      actualSecondHalf: secondHalf,
      predictedSecondHalf,
      predictedTotal,
      actualTotal,
      error,
      absoluteError: Math.abs(error)
    });
  }

  const n = results.length;

  if (n === 0) {
    return {
      gamesTested: 0,
      results: [],
      metrics: null
    };
  }

  const sum = fn =>
    results.reduce((total, game) => total + fn(game), 0);

  const mae = sum(g => g.absoluteError) / n;
  const bias = sum(g => g.error) / n;
  const rmse = Math.sqrt(sum(g => g.error ** 2) / n);

  const within = threshold =>
    100 * results.filter(
      g => g.absoluteError <= threshold
    ).length / n;

  return {
    gamesTested: n,
    metrics: {
      meanAbsoluteError: Number(mae.toFixed(2)),
      averageBias: Number(bias.toFixed(2)),
      rootMeanSquaredError: Number(rmse.toFixed(2)),
      within5Points: Number(within(5).toFixed(1)),
      within10Points: Number(within(10).toFixed(1)),
      within15Points: Number(within(15).toFixed(1))
    },
    results
  };
}

module.exports = { backtestGames };
