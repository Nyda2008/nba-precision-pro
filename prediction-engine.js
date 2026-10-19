
'use strict';

const { calculateTeamStats } = require('./stats-engine');

const MODEL_VERSION = 'experimental-possession-v1';

function number(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function resultFor(pointsA, pointsB, nameA, nameB) {
  const margin = pointsA - pointsB;
  return {
    winner: margin > 0 ? nameA : margin < 0 ? nameB : 'Tied',
    margin: round(Math.abs(margin)),
    marginPerspective: nameA,
    signedMargin: round(margin)
  };
}

function parseMadeAttempts(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)-(\d+)$/.exec(value.trim());
  if (!match) return null;
  const made = Number(match[1]);
  const attempts = Number(match[2]);
  return made <= attempts ? { made, attempts } : null;
}

function validateBoxScore(stats, points) {
  if (!stats || typeof stats !== 'object') return false;
  const fg = parseMadeAttempts(stats.FG);
  const three = parseMadeAttempts(stats['3PT']);
  const ft = parseMadeAttempts(stats.FT);
  if (!fg || !three || !ft) return false;
  if (three.made > fg.made || three.attempts > fg.attempts) {
    return false;
  }
  const oreb = number(stats.OREB);
  const turnovers = number(stats.TO);
  const statPoints = number(stats.PTS);
  if ([oreb, turnovers, statPoints].some(v => v === null || v < 0)) {
    return false;
  }
  if (oreb > fg.attempts - fg.made || statPoints !== points) {
    return false;
  }
  return true;
}

/**
 * Predict regulation second-half and final scores at halftime.
 *
 * Input:
 * {
 *   snapshotPeriod: 'halftime',
 *   teams: [
 *     { name, homeAway: 'home'|'away', firstHalfPoints,
 *       stats: { FG, '3PT', FT, OREB, TO, PTS },
 *       historicalOffensiveRating? }
 *   ],
 *   historicalWeight?: number  // 0 through 1; default 0.25
 * }
 *
 * The advanced calculation ONLY uses halftime box scores and optional
 * historical offensive ratings known before tipoff. Passing final-game
 * statistics here would invalidate any retrospective evaluation.
 */
function predictGame(input) {
  if (!input || !Array.isArray(input.teams) || input.teams.length !== 2) {
    throw new Error('Exactly two teams are required');
  }

  const weight = input.historicalWeight === undefined
    ? 0.25
    : number(input.historicalWeight);
  if (weight === null || weight < 0 || weight > 1) {
    throw new Error('historicalWeight must be between 0 and 1');
  }

  const home = input.teams.find(t => t && t.homeAway === 'home');
  const away = input.teams.find(t => t && t.homeAway === 'away');
  if (!home || !away || home === away) {
    throw new Error('One home and one away team are required');
  }

  const teams = [away, home].map(team => {
    const points = number(team.firstHalfPoints);
    if (!team.name || typeof team.name !== 'string' ||
        points === null || points < 0 || !Number.isInteger(points)) {
      throw new Error('Each team requires a name and nonnegative integer firstHalfPoints');
    }
    const prior = team.historicalOffensiveRating === undefined
      ? null
      : number(team.historicalOffensiveRating);
    if (team.historicalOffensiveRating !== undefined &&
        (prior === null || prior <= 0)) {
      throw new Error('historicalOffensiveRating must be positive');
    }
    return { ...team, points, prior };
  });

  const firstHalfTotal = teams[0].points + teams[1].points;
  const baseline = {
    secondHalfTotal: firstHalfTotal,
    finalTotal: 2 * firstHalfTotal,
    teams: teams.map(t => ({
      name: t.name,
      homeAway: t.homeAway,
      projectedSecondHalfPoints: t.points,
      projectedFinalPoints: 2 * t.points
    }))
  };

  const warnings = [
    'Experimental model; no demonstrated betting edge or calibrated probabilities.',
    'Inputs must be captured at halftime, not reconstructed from final-game box scores.',
    'Overtime is excluded from all projections.'
  ];

  let advanced = null;
  if (input.snapshotPeriod !== 'halftime') {
    warnings.push('Advanced projection unavailable: snapshotPeriod must be halftime.');
  } else if (!teams.every(t => validateBoxScore(t.stats, t.points))) {
    warnings.push('Advanced projection unavailable: valid halftime team box scores are required.');
  } else {
    const calculated = teams.map(t => calculateTeamStats({
      name: t.name,
      stats: t.stats
    }));

    if (!calculated.every(t => t.available)) {
      warnings.push('Advanced projection unavailable: insufficient possessions.');
    } else {
      // Both teams share a court, so use the mean of their estimated
      // first-half possession counts for a common second-half pace.
      const pace = calculated.reduce(
        (sum, t) => sum + t.estimatedPossessions, 0
      ) / 2;
      const projections = teams.map((team, i) => {
        const observedRating = calculated[i].offensiveRating;
        const appliedWeight = team.prior === null ? 0 : weight;
        const rating = observedRating * (1 - appliedWeight) +
          (team.prior ?? 0) * appliedWeight;
        const secondHalf = pace * rating / 100;
        return {
          name: team.name,
          homeAway: team.homeAway,
          firstHalfPoints: team.points,
          estimatedFirstHalfPossessions: calculated[i].estimatedPossessions,
          observedOffensiveRating: observedRating,
          historicalOffensiveRating: team.prior,
          projectedSecondHalfPoints: round(secondHalf),
          projectedFinalPoints: round(team.points + secondHalf)
        };
      });
      const secondHalf = projections.reduce(
        (sum, t) => sum + t.projectedSecondHalfPoints, 0
      );
      const final = projections.reduce(
        (sum, t) => sum + t.projectedFinalPoints, 0
      );
      advanced = {
        method: 'Shared estimated pace and blended offensive efficiency',
        modelVersion: MODEL_VERSION,
        calibrated: false,
        projectedSecondHalfPossessionsPerTeam: round(pace),
        projectedSecondHalfTotal: round(secondHalf),
        projectedFinalTotal: round(final),
        projectedSecondHalfResult: resultFor(
          projections[0].projectedSecondHalfPoints,
          projections[1].projectedSecondHalfPoints,
          teams[0].name, teams[1].name
        ),
        projectedFinalResult: resultFor(
          projections[0].projectedFinalPoints,
          projections[1].projectedFinalPoints,
          teams[0].name, teams[1].name
        ),
        teams: projections
      };
    }
  }

  // Never disguise fallback baseline projections as an advanced model.
  const selected = advanced || {
    method: 'First-half scoring extrapolation (baseline)',
    modelVersion: 'first-half-baseline-v1',
    calibrated: false,
    projectedSecondHalfTotal: baseline.secondHalfTotal,
    projectedFinalTotal: baseline.finalTotal,
    projectedSecondHalfResult: resultFor(
      teams[0].points, teams[1].points, teams[0].name, teams[1].name
    ),
    projectedFinalResult: resultFor(
      2 * teams[0].points, 2 * teams[1].points,
      teams[0].name, teams[1].name
    ),
    teams: baseline.teams
  };

  return {
    modelUsed: advanced ? MODEL_VERSION : 'first-half-baseline-v1',
    firstHalfTotal,
    baseline,
    prediction: selected,
    warnings
  };
}

module.exports = { predictGame };
