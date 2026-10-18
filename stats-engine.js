
'use strict';

function getNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getAttempts(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+)-(\d+)$/);
  return match ? Number(match[2]) : null;
}

function getMakes(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+)-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function calculateTeamStats(team) {
  const stats = team.stats || {};

  const fga = getAttempts(stats.FG);
  const fgm = getMakes(stats.FG);
  const threeMade = getMakes(stats['3PT']);
  const fta = getAttempts(stats.FT);
  const oreb = getNumber(stats.OREB);
  const turnovers = getNumber(stats.TO);
  const points = getNumber(stats.PTS);

  const values = [
    fga, fgm, threeMade, fta,
    oreb, turnovers, points
  ];

  if (values.some(value => value === null)) {
    return {
      team: team.name,
      available: false,
      reason: 'Required game statistics are missing'
    };
  }

  const possessions =
    fga - oreb + turnovers + 0.44 * fta;

  if (possessions <= 0 || fga <= 0) {
    return {
      team: team.name,
      available: false,
      reason: 'Insufficient possessions or field-goal attempts'
    };
  }

  return {
    team: team.name,
    available: true,
    points,
    fga,
    fgm,
    threeMade,
    fta,
    oreb,
    turnovers,
    estimatedPossessions: round(possessions),
    offensiveRating: round(
      100 * points / possessions
    ),
    effectiveFGPercentage: round(
      100 * (fgm + 0.5 * threeMade) / fga
    ),
    turnoverRate: round(
      100 * turnovers / possessions
    )
  };
}

function analyzeGame(game) {
  return {
    league: game.league,
    analyzedAt: new Date().toISOString(),
    teams: (game.teams || []).map(calculateTeamStats)
  };
}

module.exports = {
  calculateTeamStats,
  analyzeGame
};
