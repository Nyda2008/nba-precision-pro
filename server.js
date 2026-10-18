
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { Pool } = require('pg');
const { analyzeGame } = require('./stats-engine');
const { createAnalyticsStore } = require('./analytics-store');


const PORT = Number(process.env.PORT) || 3000;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
const cache = new Map();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 10000
});
const analyticsStore = createAnalyticsStore(pool);

const leagues = [
  { id: 'nba', name: 'NBA', country: 'USA', provider: 'espn' },
  { id: 'wnba', name: 'WNBA', country: 'USA', provider: 'espn' },
  { id: 'acb', name: 'Liga ACB', country: 'Spain', provider: null },
  { id: 'cba', name: 'CBA', country: 'China', provider: null },
  { id: 'nbl-au', name: 'NBL', country: 'Australia', provider: null },
  { id: 'nbl-nz', name: 'NBL', country: 'New Zealand', provider: null },
  { id: 'bsn', name: 'BSN', country: 'Puerto Rico', provider: null },
  { id: 'cibapac', name: 'CIBAPAC', country: 'Mexico', provider: null },
  { id: 'euroleague', name: 'EuroLeague', country: 'International', provider: null },
  { id: 'eurocup', name: 'EuroCup', country: 'International', provider: null },
  { id: 'b-league', name: 'B.League', country: 'Japan', provider: null },
  { id: 'kbl', name: 'KBL', country: 'South Korea', provider: null },
  { id: 'nbb', name: 'NBB', country: 'Brazil', provider: null },
  { id: 'lba', name: 'Lega Basket Serie A', country: 'Italy', provider: null },
  { id: 'bbl', name: 'BBL', country: 'Germany', provider: null },
  { id: 'lnb', name: 'LNB Elite', country: 'France', provider: null },
  { id: 'bsl', name: 'Basketbol Super Ligi', country: 'Turkey', provider: null },
  { id: 'gbl', name: 'Greek Basket League', country: 'Greece', provider: null },
  { id: 'vtb', name: 'VTB United League', country: 'International', provider: null }
];

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

async function getJSON(key, url, ttl = 15000) {
  const old = cache.get(key);
  if (old && Date.now() - old.time < ttl) return old.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NBA-Precision-Pro/1.0 (personal analytics)',
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error('Data provider returned ' + response.status);
    }

    const data = await response.json();
    cache.set(key, { time: Date.now(), data });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function parseTotals(playerGroup) {
  const team = playerGroup.team || {};
  const statistics = playerGroup.statistics?.[0] || {};
  const stats = {};

  (statistics.labels || []).forEach((label, index) => {
    stats[label] = (statistics.totals || [])[index];
  });

  return {
    id: team.id,
    name: team.displayName,
    abbr: team.abbreviation,
    stats
  };
}

function parseEvent(event, leagueId) {
  return {
    id: event.id,
    league: leagueId,
    name: event.name,
    date: event.date,
    status: event.status?.type?.description,
    shortDetail: event.status?.type?.shortDetail,
    competitors: (event.competitions?.[0]?.competitors || []).map(c => ({
      id: c.team?.id,
      name: c.team?.displayName,
      abbr: c.team?.abbreviation,
      homeAway: c.homeAway,
      score: c.score
    }))
  };
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      league TEXT NOT NULL,
      game_id TEXT NOT NULL,
      game_date TIMESTAMPTZ,
      name TEXT,
      status TEXT,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (league, game_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_snapshots (
      id BIGSERIAL PRIMARY KEY,
      league TEXT NOT NULL,
      game_id TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data JSONB NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS game_snapshots_lookup
    ON game_snapshots (league, game_id, observed_at DESC)
  `);

  await analyticsStore.init();
  console.log('PostgreSQL connected; game tables ready');
}

async function storeGames(events) {
  for (const event of events) {
    if (!event.id) continue;

    const values = [
      event.league,
      String(event.id),
      event.date || null,
      event.name || null,
      event.status || null,
      JSON.stringify(event)
    ];

    await pool.query(`
      INSERT INTO games (
        league, game_id, game_date, name, status, data
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (league, game_id) DO UPDATE SET
        game_date = EXCLUDED.game_date,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        data = EXCLUDED.data,
        updated_at = NOW()
    `, values);

    await pool.query(`
      INSERT INTO game_snapshots (league, game_id, data)
      SELECT $1, $2, $3::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM (
          SELECT data
          FROM game_snapshots
          WHERE league = $1 AND game_id = $2
          ORDER BY observed_at DESC, id DESC
          LIMIT 1
        ) latest
        WHERE latest.data = $3::jsonb
      )
    `, [
      event.league,
      String(event.id),
      JSON.stringify(event)
    ]);
  }
}

async function loadGames(leagueId) {
  const url = ESPN + '/' + leagueId + '/scoreboard';
  const data = await getJSON(
    'games:' + leagueId,
    url,
    20000
  );

  const events = (data.events || []).map(e =>
    parseEvent(e, leagueId)
  );

  await storeGames(events);
  return events;
}

const root = path.resolve(__dirname, 'public');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function handler(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');

    if (u.pathname === '/api/health') {
      await pool.query('SELECT 1');

      return send(res, 200, {
        ok: true,
        service: 'NBA Precision Pro',
        database: 'connected',
        version: 'db-1'
      });
    }

    if (u.pathname === '/api/leagues') {
      return send(res, 200, {
        leagues: leagues.map(l => ({
          ...l,
          available: Boolean(l.provider)
        }))
      });
    }

    if (u.pathname === '/api/games/all') {
      const active = leagues.filter(l => l.provider);
      const results = await Promise.allSettled(
        active.map(l => loadGames(l.id))
      );

      const events = [];
      const errors = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          events.push(...result.value);
        } else {
          errors.push({
            league: active[index].id,
            message: result.reason?.message || 'Unavailable'
          });
        }
      });

      return send(res, 200, {
        source: 'ESPN',
        retrievedAt: new Date().toISOString(),
        events,
        errors
      });
    }

    if (u.pathname === '/api/games') {
      const leagueId = u.searchParams.get('league') || 'nba';
      const league = leagues.find(l => l.id === leagueId);

      if (!league) {
        return send(res, 400, {
          error: 'Unknown league'
        });
      }

      if (!league.provider) {
        return send(res, 503, {
          error: 'No live provider configured for ' + league.name
        });
      }

      const events = await loadGames(league.id);

      return send(res, 200, {
        source: 'ESPN',
        league: league.id,
        retrievedAt: new Date().toISOString(),
        events
      });
    }

    if (u.pathname === '/api/game') {
      const leagueId = u.searchParams.get('league') || 'nba';
      const league = leagues.find(l => l.id === leagueId);

      if (!league) {
        return send(res, 400, {
          error: 'Unknown league'
        });
      }

      if (!league.provider) {
        return send(res, 503, {
          error: 'No live provider configured for ' + league.name
        });
      }

      const id = u.searchParams.get('id');

      if (!/^\d{5,15}$/.test(id || '')) {
        return send(res, 400, {
          error: 'Invalid game ID'
        });
      }

      const data = await getJSON(
        'game:' + league.id + ':' + id,
        ESPN + '/' + league.id + '/summary?event=' + id,
        12000
      );

      const header = data.header?.competitions?.[0];
      const teams = (data.boxscore?.players || []).map(parseTotals);

      return send(res, 200, {
        source: 'ESPN',
        league: league.id,
        retrievedAt: new Date().toISOString(),
        status: header?.status,
        competitors: (header?.competitors || []).map(c => ({
          id: c.team?.id,
          name: c.team?.displayName,
          homeAway: c.homeAway,
          score: c.score
        })),
        teams,
        notes: 'Unavailable statistics are not estimated or filled in.'
      });
    }

    if (u.pathname === '/api/analyze') {
      const leagueId = u.searchParams.get('league') || 'nba';
      const league = leagues.find(l => l.id === leagueId);

      if (!league) {
        return send(res, 400, { error: 'Unknown league' });
      }

      if (!league.provider) {
        return send(res, 503, {
          error: 'No data provider configured for this league'
        });
      }

      const id = u.searchParams.get('id');

      if (!/^\d{5,15}$/.test(id || '')) {
        return send(res, 400, { error: 'Invalid game ID' });
      }

      const data = await getJSON(
        'game:' + league.id + ':' + id,
        ESPN + '/' + league.id + '/summary?event=' + id,
        12000
      );

      const teams = (data.boxscore?.players || []).map(parseTotals);

      const analysis = analyzeGame({
        league: league.id,
        teams
      });
      
      await analyticsStore.save(id, analysis);

      return send(res, 200, {
        source: 'ESPN',
        gameId: id,
        gameStatus: data.header?.competitions?.[0]?.status?.type?.description || null,
        ...analysis
      });
    }


    if (u.pathname === '/api/db/stats') {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM games) AS games,
          (SELECT COUNT(*)::int FROM game_snapshots) AS snapshots
      `);

      return send(res, 200, {
        database: 'connected',
        ...result.rows[0]
      });
    }

    let relative;

    try {
      relative = decodeURIComponent(
        u.pathname === '/' ? 'index.html' : u.pathname.slice(1)
      );
    } catch {
      return send(res, 400, {
        error: 'Invalid path'
      });
    }

    const full = path.resolve(root, relative);

    if (!full.startsWith(root + path.sep)) {
      return send(res, 403, {
        error: 'Forbidden'
      });
    }

    fs.readFile(full, (error, body) => {
      if (error) {
        res.writeHead(404);
        return res.end('Not found');
      }

      res.writeHead(200, {
        'Content-Type': mime[path.extname(full)] ||
          'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      });

      res.end(body);
    });
  } catch (error) {
    console.error('Request failed:', error.message);

    send(res, 502, {
      error: 'Request failed; check service logs'
    });
  }
}

const LIVE_POLL_MS = 15000;
const PREGAME_POLL_MS = 60000;
const IDLE_POLL_MS = 300000;

let collectorRunning = false;
let collectorTimer = null;

async function collectLiveGames() {
  if (collectorRunning) return;

  collectorRunning = true;
  let nextInterval = IDLE_POLL_MS;

  try {
    let liveFound = false;
    let upcomingFound = false;

    for (const leagueId of ['nba', 'wnba']) {
      cache.delete('games:' + leagueId);

      const events = await loadGames(leagueId);

      for (const event of events) {
        const status = (event.status || '').toLowerCase();

        if (
          status.includes('progress') ||
          status.includes('halftime') ||
          status.includes('end of')
        ) {
          liveFound = true;
        }

        const tipoff = Date.parse(event.date);

        if (
          Number.isFinite(tipoff) &&
          tipoff > Date.now() &&
          tipoff - Date.now() < 1800000
        ) {
          upcomingFound = true;
        }
      }
    }

    if (liveFound) {
      nextInterval = LIVE_POLL_MS;
    } else if (upcomingFound) {
      nextInterval = PREGAME_POLL_MS;
    }

    console.log(
      'Game collector completed:',
      new Date().toISOString(),
      'next interval:',
      nextInterval / 1000,
      'seconds'
    );
  } catch (error) {
    console.error('Collector error:', error.message);
    nextInterval = PREGAME_POLL_MS;
  } finally {
    collectorRunning = false;

    collectorTimer = setTimeout(
      collectLiveGames,
      nextInterval
    );
  }
}

function startCollector() {
  console.log('Automatic game collector started');
  collectLiveGames();
}

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

pool.on('error', error => {
  console.error('PostgreSQL pool error:', error.message);
});

initDB()
  .then(() => {
    http.createServer(handler).listen(PORT, () => {
      console.log('NBA Precision Pro listening on ' + PORT);
      startCollector();
    });
  })
  .catch(error => {
    console.error('Database startup failed:', error.message);
    process.exit(1);
  });
