
'use strict';

function createHistoricalBacktestRunner({
  analyzePeriods,
  backtestGames,
  fetchSummary,
  parsePeriodTeams,
  backtestStore
}) {
  if (
    typeof analyzePeriods !== 'function' ||
    typeof backtestGames !== 'function' ||
    typeof fetchSummary !== 'function' ||
    typeof parsePeriodTeams !== 'function' ||
    !backtestStore ||
    typeof backtestStore.saveReport !== 'function'
  ) {
    throw new Error(
      'Historical backtest runner dependencies are missing'
    );
  }

  const supportedLeagues = new Set([
    'nba', 'wnba', 'ncaam', 'ncaaw'
  ]);

  function validScore(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function validateGame(teams, analysis, league) {
    if (!Array.isArray(teams) || teams.length !== 2) {
      return 'Exactly two teams are required';
    }

    const expectedPeriods = league === 'ncaam' ? 2 : 4;

    for (const team of teams) {
      if (
        !Array.isArray(team.quarters) ||
        team.quarters.length !== expectedPeriods
      ) {
        return 'Incomplete regulation periods or overtime';
      }

      const periodScores = team.quarters.map(
        period => period.points
      );

      if (!periodScores.every(validScore)) {
        return 'Invalid period scoring';
      }

      const total = Number(team.totalScore);

      if (!validScore(total)) {
        return 'Invalid final score';
      }

      const regulationScore = periodScores.reduce(
        (sum, score) => sum + score,
        0
      );

      if (regulationScore !== total) {
        return 'Period totals do not match final score';
      }
    }

    if (
      !Number.isFinite(analysis.firstHalf?.combinedPoints) ||
      !Number.isFinite(analysis.secondHalf?.combinedPoints)
    ) {
      return 'Missing first-half or second-half totals';
    }

    return null;
  }

  async function run({
    league,
    games,
    modelVersion = 'first-half-baseline-v1'
  }) {
    if (!supportedLeagues.has(league)) {
      throw new Error('Unsupported league');
    }

    if (!Array.isArray(games)) {
      throw new Error('Games must be an array');
    }

    const seen = new Set();
    const eligible = [];
    const skipped = [];

    for (const game of games) {
      const id = String(game.game_id || game.gameId || '');

      if (!/^\d{5,15}$/.test(id)) {
        skipped.push({
          gameId: id,
          reason: 'Invalid game ID'
        });
        continue;
      }

      if (seen.has(id)) {
        skipped.push({
          gameId: id,
          reason: 'Duplicate game in batch'
        });
        continue;
      }

      seen.add(id);

      try {
        const summary = await fetchSummary(league, id);

        const competition =
          summary.header?.competitions?.[0];

        if (!competition?.status?.type?.completed) {
          skipped.push({
            gameId: id,
            reason: 'Game not completed'
          });
          continue;
        }

        const { teams } = parsePeriodTeams(summary);

        if (teams.length !== 2) {
          skipped.push({
            gameId: id,
            reason: 'Missing team data'
          });
          continue;
        }

        const analysis = analyzePeriods(teams, league);

        const problem = validateGame(
          teams,
          analysis,
          league
        );

        if (problem) {
          skipped.push({
            gameId: id,
            reason: problem
          });
          continue;
        }

        eligible.push({
          gameId: id,
          gameDate: game.game_date ?? game.gameDate ?? null,
          firstHalfTotal: analysis.firstHalf.combinedPoints,
          secondHalfTotal: analysis.secondHalf.combinedPoints
        });
      } catch (error) {
        skipped.push({
          gameId: id,
          reason: error.message
        });
      }
    }

    const report = backtestGames(eligible);

    const saved = await backtestStore.saveReport(
      league,
      report,
      modelVersion
    );

    return {
      league,
      modelVersion,
      gamesSelected: games.length,
      uniqueGames: seen.size,
      gamesTested: report.gamesTested,
      newlySaved: saved.processedGames,
      skipped,
      metrics: report.metrics,
      results: report.results,
      monthlyAccuracy: report.monthlyAccuracy
    };
  }

  return { run };
}

module.exports = { createHistoricalBacktestRunner };
