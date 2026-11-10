
'use strict';

// Basketball Precision Pro
// Fatigue Research Module — Version 1
// Read-only research. Does not change predictions or betting rules.

const ESPN_ROOT =
  'https://site.api.espn.com/apis/site/v2/sports/basketball';

const SLUGS = {
  ncaam: 'mens-college-basketball',
  ncaaw: 'womens-college-basketball'
};

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error('ESPN HTTP ' + response.status);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function utcDay(date) {
  const ms = Date.parse(date);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function dayDifference(later, earlier) {
  const a = Date.parse(later + 'T00:00:00Z');
  const b = Date.parse(earlier + 'T00:00:00Z');
  return Math.round((a - b) / 86400000);
}

function minutesValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const s = String(value ?? '').trim();

  if (/^\d+:\d{1,2}$/.test(s)) {
    const [m, sec] = s.split(':').map(Number);
    if (sec >= 60) return null;
    return m + sec / 60;
  }

  if (/^\d+(\.\d+)?$/.test(s)) {
    return Number(s);
  }

  return null;
}

function playerMinutes(playerGroup) {
  const group = playerGroup.statistics?.[0] || {};
  const labels = group.labels || [];
  const keys = group.keys || [];

  let minIndex = labels.findIndex(
    label => String(label).toUpperCase() === 'MIN'
  );

  if (minIndex < 0) {
    minIndex = keys.findIndex(
      key => String(key).toLowerCase() === 'minutes'
    );
  }

  const players = (group.athletes || []).map(item => {
    const athlete = item.athlete || {};
    const raw = minIndex >= 0
      ? item.stats?.[minIndex]
      : null;

    return {
      id: athlete.id || null,
      name: athlete.displayName || 'Unknown',
      starter: item.starter === true,
      minutes: minutesValue(raw)
    };
  });

  const withMinutes = players.filter(
    player => player.minutes !== null
  );

  const sorted = [...withMinutes].sort(
    (a, b) => b.minutes - a.minutes
  );

  const total = withMinutes.reduce(
    (sum, player) => sum + player.minutes, 0
  );

  return {
    teamId: String(playerGroup.team?.id || ''),
    team: playerGroup.team?.displayName || null,
    minuteDataAvailable: withMinutes.length > 0,
    playersWithMinutes: withMinutes.length,
    totalRecordedPlayerMinutes: Number(total.toFixed(1)),
    playersWithFivePlusMinutes: withMinutes.filter(
      player => player.minutes >= 5
    ).length,
    topFiveMinutes: Number(
      sorted.slice(0, 5).reduce(
        (sum, player) => sum + player.minutes, 0
      ).toFixed(1)
    ),
    players
  };
}

function summarizeSchedule(teamId, currentDate, games) {
  const earlier = games
    .filter(game => game.teamIds.includes(String(teamId)))
    .filter(game => game.date < currentDate)
    .sort((a, b) => b.date.localeCompare(a.date));

  const latest = earlier[0] || null;

  return {
    previousGameDate: latest?.date || null,
    daysSincePreviousGame: latest
      ? dayDifference(currentDate, latest.date)
      : null,
    calendarRestDays: latest
      ? Math.max(0, dayDifference(currentDate, latest.date) - 1)
      : null,
    gamesInPriorSevenDays: earlier.length,
    shortRestFlag: latest
      ? dayDifference(currentDate, latest.date) <= 1
      : null,
    note: latest
      ? null
      : 'No previous game found in the seven-day search window.'
  };
}

async function analyzeFatigue(options) {
  const {
    league = 'ncaam',
    gameId,
    request = fetchJson
  } = options || {};

  const slug = SLUGS[league];

  if (!slug) {
    throw new Error('Only NCAAM and NCAAW are supported.');
  }

  if (!/^\d{5,15}$/.test(String(gameId || ''))) {
    throw new Error('Valid ESPN game ID required.');
  }

  const root = ESPN_ROOT + '/' + slug;

  const summary = await request(
    root + '/summary?event=' + gameId
  );

  const competition = summary.header?.competitions?.[0];

  if (!competition) {
    throw new Error('Game summary is not available.');
  }

  const gameDate = utcDay(
    competition.date ||
    summary.header?.competitions?.[0]?.status?.date
  );

  if (!gameDate) {
    throw new Error('Game date is missing.');
  }

  const teams = (competition.competitors || []).map(c => ({
    id: String(c.team?.id || ''),
    name: c.team?.displayName || null,
    homeAway: c.homeAway || null
  }));

  const workload = (summary.boxscore?.players || [])
    .map(playerMinutes);

  const historicalGames = [];
  const unavailableDates = [];

  // Search the seven preceding UTC calendar dates.
  // Sequential requests avoid overwhelming the provider.
  for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
    const date = new Date(
      Date.parse(gameDate + 'T00:00:00Z') -
      daysAgo * 86400000
    ).toISOString().slice(0, 10);

    const espnDate = date.replace(/-/g, '');

    try {
      const scoreboard = await request(
        root + '/scoreboard?dates=' + espnDate +
        '&groups=50&limit=500'
      );

      for (const event of scoreboard.events || []) {
        const completed =
          event.status?.type?.completed === true ||
          event.status?.type?.name === 'STATUS_FINAL';

        if (!completed) continue;

        historicalGames.push({
          gameId: String(event.id),
          date: utcDay(event.date),
          teamIds: (
            event.competitions?.[0]?.competitors || []
          ).map(c => String(c.team?.id || ''))
        });
      }
    } catch (error) {
      unavailableDates.push({
        date,
        reason: error.message
      });
    }
  }

  const results = teams.map(team => ({
    ...team,
    rest: summarizeSchedule(
      team.id, gameDate, historicalGames
    ),
    halftimeWorkload: workload.find(
      group => group.teamId === team.id
    ) || null
  }));

  return {
    module: 'fatigue-research-v1',
    source: 'ESPN',
    league,
    gameId: String(gameId),
    gameDate,
    retrievedAt: new Date().toISOString(),
    teams: results,
    coverage: {
      historicalDaysRequested: 7,
      historicalDaysAvailable: 7 - unavailableDates.length,
      unavailableDates
    },
    notes: [
      'This module measures workload proxies, not actual fatigue.',
      'Rest is based on previous UTC calendar dates.',
      'No previous game found does not mean the team is rested.',
      'Player minutes may be unavailable or delayed at halftime.',
      'No prediction or sportsbook decision is modified.'
    ]
  };
}

module.exports = {
  analyzeFatigue,
  playerMinutes,
  minutesValue,
  summarizeSchedule
};
