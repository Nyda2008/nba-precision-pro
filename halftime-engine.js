
'use strict';

function analyzePeriods(teams) {
  if (!Array.isArray(teams) || teams.length !== 2) {
    throw new Error('Exactly two teams are required');
  }

  const parsed = teams.map(team => {
    const quarters = (team.quarters || []).map(q => {
      if (
        q.points === null ||
        q.points === undefined ||
        q.points === '' ||
        !Number.isFinite(Number(q.points))
      ) {
        return null;
      }

      return Number(q.points);
    });
    
    return {
      name: team.team,
      homeAway: team.homeAway,
      totalScore: Number(team.totalScore),
      quarters
    };

  });
 
  const away = parsed.find(team => team.homeAway === 'away');
  const home = parsed.find(team => team.homeAway === 'home');

  if (!away || !home) {
    throw new Error('Home and away teams are required');
  }


  const valid = index =>
    Number.isFinite(away.quarters[index]) &&
    Number.isFinite(home.quarters[index]);

  const periods = [];

  const count = Math.max(
    away.quarters.length,
    home.quarters.length
  );

  for (let i = 0; i < count; i++) {
    if (!valid(i)) continue;

    const a = away.quarters[i];
    const h = home.quarters[i];

    periods.push({
      period: i + 1,
      label: i < 4 ? 'Q' + (i + 1) : 'OT' + (i - 3),
      teams: [
        { name: away.name, points: a },
        { name: home.name, points: h }
      ],
      combinedPoints: a + h,
      margin: h - a,
      marginPerspective: home.name,
      winner: a === h

        ? 'Tied'
        : a > h ? away.name : home.name
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

    return values.reduce((sum, value) => sum + value, 0);
  }

  const firstHalf = parsed.map(team => ({
    team: team.name,
    points: sumPeriod(team, 0, 2)
  }));

  const secondHalf = parsed.map(team => ({
    team: team.name,
    points: sumPeriod(team, 2, 4)
  }));

  const totalFor = rows =>
    rows.every(row => Number.isFinite(row.points))
      ? rows.reduce((sum, row) => sum + row.points, 0)
      : null;

  const firstHalfTotal = totalFor(firstHalf);
  const secondHalfTotal = totalFor(secondHalf);

  const q1 = periods.find(p => p.period === 1);
  const q2 = periods.find(p => p.period === 2);

  const halftimeProjection = firstHalfTotal === null
    ? null
    : {
        method: 'First-half scoring extrapolation',
        projectedRegulationTotal: firstHalfTotal * 2,
        projectedSecondHalfTotal: firstHalfTotal,
        calibrated: false,
        warning: 'Baseline only. Not a validated betting prediction.'
      };

  return {
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
      q1 && q2 ? q2.combinedPoints - q1.combinedPoints : null,
    halftimeProjection,
    notes: [
      'Period scoring is not equivalent to possession-based pace.',
      'Overtime scoring is excluded from regulation half totals.',
      'No betting probability is claimed.'
    ]
  };
}

module.exports = { analyzePeriods };
