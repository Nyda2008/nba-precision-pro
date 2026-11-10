
'use strict';

// Basketball Precision Pro — Team Statistics Research v1
// Read-only. Only games preceding the target date are eligible.
// No predictions, database writes, injury assumptions, or betting decisions.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
const SLUGS = {
  ncaam: 'mens-college-basketball',
  ncaaw: 'womens-college-basketball'
};

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('ESPN HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function day(value) {
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null;
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? Number((valid.reduce((sum, n) => sum + n, 0) / valid.length).toFixed(2))
    : null;
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function key(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractStats(team) {
  const stats = new Map();
  for (const item of team?.statistics || []) {
    const name = key(item.name || item.label || item.abbreviation);
    if (name) stats.set(name, item.displayValue ?? item.value ?? null);
  }
  const first = (...names) => {
    for (const name of names) {
      const raw = stats.get(key(name));
      const n = number(raw);
      if (n !== null) return n;
    }
    return null;
  };
  const madeAttempted = (...names) => {
    for (const name of names) {
      const raw = stats.get(key(name));
      const match = String(raw ?? '').match(/^(\d+)\s*-\s*(\d+)$/);
      if (match) return { made: Number(match[1]), attempted: Number(match[2]) };
    }
    return null;
  };
  const fg = madeAttempted('fieldGoalsMade-fieldGoalsAttempted', 'fieldGoals');
  const threes = madeAttempted('threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointFieldGoals');
  const ft = madeAttempted('freeThrowsMade-freeThrowsAttempted', 'freeThrows');
  return {
    fgm: first('fieldGoalsMade') ?? fg?.made ?? null,
    fga: first('fieldGoalsAttempted') ?? fg?.attempted ?? null,
    threeMade: first('threePointFieldGoalsMade') ?? threes?.made ?? null,
    threeAttempted: first('threePointFieldGoalsAttempted') ?? threes?.attempted ?? null,
    ftm: first('freeThrowsMade') ?? ft?.made ?? null,
    fta: first('freeThrowsAttempted') ?? ft?.attempted ?? null,
    offensiveRebounds: first('offensiveRebounds'),
    turnovers: first('turnovers', 'totalTurnovers')
  };
}

function safeRate(numerator, denominator, multiplier = 1) {
  return Number.isFinite(numerator) &&
    Number.isFinite(denominator) && denominator > 0
    ? round(multiplier * numerator / denominator)
    : null;
}

function possessions(stats) {
  const { fga, offensiveRebounds, turnovers, fta } = stats;
  if (![fga, offensiveRebounds, turnovers, fta].every(Number.isFinite)) {
    return null;
  }
  return Math.max(0, fga - offensiveRebounds + turnovers + 0.44 * fta);
}

function metrics(records) {
  const values = records.map(r => {
    const pos = possessions(r.stats);
    const oppPos = possessions(r.opponentStats);
    const sharedPossessions = pos !== null && oppPos !== null
      ? (pos + oppPos) / 2 : null;
    return {
      points: r.points,
      pointsAllowed: r.pointsAllowed,
      turnovers: r.stats.turnovers,
      opponentTurnovers: r.opponentStats.turnovers,
      possessions: sharedPossessions,
      offensiveRating: safeRate(r.points, sharedPossessions, 100),
      defensiveRating: safeRate(r.pointsAllowed, sharedPossessions, 100),
      turnoverPct: safeRate(r.stats.turnovers, sharedPossessions, 100),
      opponentTurnoverPct: safeRate(r.opponentStats.turnovers, sharedPossessions, 100),
      effectiveFgPct: Number.isFinite(r.stats.fgm) &&
        Number.isFinite(r.stats.threeMade)
        ? safeRate(r.stats.fgm + 0.5 * r.stats.threeMade, r.stats.fga, 100)
        : null
    };
  });
  const out = { games: records.length };
  for (const field of [
    'points', 'pointsAllowed', 'turnovers', 'opponentTurnovers',
    'possessions', 'offensiveRating', 'defensiveRating',
    'turnoverPct', 'opponentTurnoverPct', 'effectiveFgPct'
  ]) {
    out[field] = average(values.map(v => v[field]));
    out[field + 'SampleSize'] = values.filter(v => Number.isFinite(v[field])).length;
  }
  return out;
}

function parseScoreboardEvent(event) {
  const competition = event.competitions?.[0] || {};
  return {
    id: String(event.id || ''),
    gameDate: day(event.date),
    completed: event.status?.type?.completed === true ||
      event.status?.type?.name === 'STATUS_FINAL',
    teams: (competition.competitors || []).map(c => ({
      id: String(c.team?.id || ''),
      homeAway: c.homeAway || null
    }))
  };
}

function recordFromSummary(summary, teamId, gameId, gameDate) {
  const competitors = summary.header?.competitions?.[0]?.competitors || [];
  const own = competitors.find(c => String(c.team?.id) === String(teamId));
  const opp = competitors.find(c => String(c.team?.id) !== String(teamId));
  if (!own || !opp) return null;
  const points = number(own.score);
  const pointsAllowed = number(opp.score);
  if (points === null || pointsAllowed === null) return null;
  const boxTeams = summary.boxscore?.teams || [];
  const box = id => boxTeams.find(t => String(t.team?.id) === String(id));
  return {
    gameId, gameDate,
    homeAway: own.homeAway || null,
    points, pointsAllowed,
    stats: extractStats(box(teamId)),
    opponentStats: extractStats(box(opp.team?.id))
  };
}

async function analyzeTeamStatistics(options = {}) {
  const { league = 'ncaam', gameId, request = getJSON,
    lookbackDays = 14, gamesPerTeam = 5 } = options;
  const slug = SLUGS[league];
  if (!slug) throw new Error('Only ncaam and ncaaw are supported');
  if (!/^\d{5,15}$/.test(String(gameId || ''))) {
    throw new Error('Valid ESPN game ID required');
  }
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 30 ||
      !Number.isInteger(gamesPerTeam) || gamesPerTeam < 1 || gamesPerTeam > 10) {
    throw new Error('Invalid lookback settings');
  }
  const root = ESPN + '/' + slug;
  const current = await request(root + '/summary?event=' + gameId);
  const competition = current.header?.competitions?.[0];
  const targetDate = day(competition?.date || current.header?.date);
  if (!competition || !targetDate) throw new Error('Target game data unavailable');
  const teams = (competition.competitors || []).map(c => ({
    id: String(c.team?.id || ''),
    name: c.team?.displayName || null,
    homeAway: c.homeAway || null
  }));
  if (teams.length !== 2 || teams.some(t => !t.id)) {
    throw new Error('Two teams required');
  }

  const dates = Array.from({ length: lookbackDays }, (_, i) =>
    new Date(Date.parse(targetDate + 'T00:00:00Z') -
      (i + 1) * 86400000).toISOString().slice(0, 10)
  );
  const snapshots = await Promise.allSettled(dates.map(date =>
    request(root + '/scoreboard?dates=' + date.replace(/-/g, '') +
      '&groups=50&limit=500')
  ));
  const unavailableDates = [];
  const eventMap = new Map();
  for (let i = 0; i < dates.length; i++) {
    const result = snapshots[i];
    if (result.status === 'rejected') {
      unavailableDates.push(dates[i]);
      continue;
    }
    for (const raw of result.value.events || []) {
      const event = parseScoreboardEvent(raw);
      if (event.completed && event.gameDate &&
          event.gameDate < targetDate && event.id && !eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    }
  }
  const allEvents = [...eventMap.values()].sort((a, b) =>
    b.gameDate.localeCompare(a.gameDate) || b.id.localeCompare(a.id)
  );
  const byTeam = teams.map(team => ({
    ...team,
    events: allEvents.filter(e => e.teams.some(t => t.id === team.id))
      .slice(0, gamesPerTeam)
  }));
  const selected = [...new Set(byTeam.flatMap(t => t.events.map(e => e.id)))];
  const fetched = await Promise.allSettled(selected.map(id =>
    request(root + '/summary?event=' + id)
  ));
  const summaries = new Map();
  for (let i = 0; i < selected.length; i++) {
    if (fetched[i].status === 'fulfilled') {
      summaries.set(selected[i], fetched[i].value);
    }
  }
  const results = byTeam.map(team => {
    const records = team.events.map(event => {
      const summary = summaries.get(event.id);
      return summary ? recordFromSummary(summary, team.id,
        event.id, event.gameDate) : null;
    }).filter(Boolean);
    return {
      teamId: team.id, team: team.name, homeAway: team.homeAway,
      priorGamesFound: team.events.length,
      gamesWithScores: records.length,
      seasonAverage: null,
      recentGames: metrics(records),
      homeGames: metrics(records.filter(r => r.homeAway === 'home')),
      awayGames: metrics(records.filter(r => r.homeAway === 'away')),
      pointGuard: {
        experience: null,
        assistToTurnoverRatio: null,
        status: 'unverified',
        injuryStatus: 'unknown',
        note: 'Guard identity, experience and injury status require separately verified historical sources.'
      }
    };
  });
  return {
    module: 'team-statistics-research-v1',
    league, gameId: String(gameId), targetDate,
    retrievedAt: new Date().toISOString(), readOnly: true,
    teams: results,
    coverage: {
      lookbackDays, gamesPerTeam,
      datesRequested: dates.length,
      datesUnavailable: unavailableDates,
      gameSummariesRequested: selected.length,
      gameSummariesAvailable: summaries.size
    },
    notes: [
      'Only games dated before target game are included.',
      'Recent averages are limited to the selected lookback window; they are not full-season averages.',
      'Possessions use an approximation: FGA - OREB + TO + 0.44*FTA.',
      'Missing statistics yield null, never zero.',
      'Injuries and guard experience are not inferred from missing information.',
      'No predictions, live analysis or betting rules are changed.'
    ]
  };
}

module.exports = { analyzeTeamStatistics, extractStats, metrics };
