
'use strict';

function analyzePeriods(teams, league = 'nba') {
  if (!Array.isArray(teams) || teams.length !== 2) {
    throw new Error('Exactly two teams are required');
  }

  const isMensCollege = league === 'ncaam';
  const regulationPeriods = isMensCollege ? 2 : 4;

  function parsePoints(value) {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    ) {
      return null;
    }

    return Number(value);
  }

  const parsed = teams.map(team => ({
    name: team.team,
    homeAway: team.homeAway,
    totalScore: parsePoints(team.totalScore),
    quarters: (team.quarters || []).map(q =>
      parsePoints(q.points)
    )
  }));

  const away = parsed.find(
    team => team.homeAway === 'away'
  );

  const home = parsed.find(
    team => team.homeAway === 'home'
  );

  if (!away || !home) {
    throw new Error('Home and away teams are required');
  }

  function validPeriod(index) {
    return (
      Number.isFinite(away.quarters[index]) &&
      Number.isFinite(home.quarters[index])
    );
  }

  const periods = [];

  const count = Math.max(
    away.quarters.length,
    home.quarters.length
  );

  for (let i = 0; i < count; i++) {
    if (!validPeriod(i)) continue;

    const awayPoints = away.quarters[i];
    const homePoints = home.quarters[i];

    const label = isMensCollege
      ? (i < 2 ? 'H' + (i + 1) : 'OT' + (i - 1))
      : (i < 4 ? 'Q' + (i + 1) : 'OT' + (i - 3));

    periods.push({
      period: i + 1,
      label,
      teams: [
        { name: away.name, points: awayPoints },
        { name: home.name, points: homePoints }
      ],
      combinedPoints: awayPoints + homePoints,
      margin: homePoints - awayPoints,
      marginPerspective: home.name,
      winner: awayPoints === homePoints
        ? 'Tied'
        : awayPoints > homePoints
          ? away.name
          : home.name
    });
  }

  function sumPeriod(team, start, end) {
    const values = team.quarters.slice(start, end);

    if (
      values.length !== end - start ||
      values.some(value => !Number.isFinite(value))
    ) {
      return null;
    }

    return values.reduce(
      (sum, value) => sum + value,
      0
    );
  }

  const firstHalfEnd = isMensCollege ? 1 : 2;
  const secondHalfEnd = regulationPeriods;

  const firstHalf = parsed.map(team => ({
    team: team.name,
    points: sumPeriod(team, 0, firstHalfEnd)
  }));

  const secondHalf = parsed.map(team => ({
    team: team.name,
    points: sumPeriod(
      team,
      firstHalfEnd,
      secondHalfEnd
    )
  }));

  function totalFor(rows) {
    return rows.every(
      row => Number.isFinite(row.points)
    )
      ? rows.reduce(
          (sum, row) => sum + row.points,
          0
        )
      : null;
  }

  const firstHalfTotal = totalFor(firstHalf);
  const secondHalfTotal = totalFor(secondHalf);

  const q1 = isMensCollege
    ? null
    : periods.find(p => p.period === 1);

  const q2 = isMensCollege
    ? null
    : periods.find(p => p.period === 2);

  const halftimeProjection = firstHalfTotal === null
    ? null
    : {
        method: 'First-half scoring extrapolation',
        projectedRegulationTotal: firstHalfTotal * 2,
        projectedSecondHalfTotal: firstHalfTotal,
        calibrated: false,
        warning:
          'Uncalibrated baseline. Use only with a completed first half. Not a validated betting prediction.'
      };

  return {
    league,
    periodFormat: isMensCollege
      ? 'two-halves'
      : 'four-quarters',

    teams: parsed.map(team => ({
      name: team.name,
      totalScore: team.totalScore
    })),

    periods,

    firstHalf: {
      teams: firstHalf,
      combinedPoints: firstHalfTotal
    },

    secondHalf: {
      teams: secondHalf,
      combinedPoints: secondHalfTotal
    },

    q1ToQ2TotalChange:
      q1 && q2
        ? q2.combinedPoints - q1.combinedPoints
        : null,

    halftimeProjection,

    notes: [
      'NCAA Men use two 20-minute halves.',
      'NBA, WNBA and NCAA Women use four quarters.',
      'Overtime is excluded from regulation totals.',
      'Period scoring is not possession-based pace.',
      'The first half must be complete before using the baseline forecast.',
      'Predictions require separate historical calibration.',
      'No betting probability is claimed.'
    ]
  };
}

module.exports = { analyzePeriods };
