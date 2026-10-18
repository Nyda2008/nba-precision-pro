
'use strict';

function createAnalyticsStore(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('A PostgreSQL pool is required');
  }

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_analytics (
        id BIGSERIAL PRIMARY KEY,
        league TEXT NOT NULL,
        game_id TEXT NOT NULL,
        team_name TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        points INTEGER,
        estimated_possessions NUMERIC,
        offensive_rating NUMERIC,
        effective_fg_percentage NUMERIC,
        turnover_rate NUMERIC,
        data JSONB NOT NULL
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS team_analytics_lookup
      ON team_analytics (
        league,
        game_id,
        team_name,
        observed_at DESC
      )
    `);

    console.log('Team analytics table ready');
  }

  async function save(gameId, analysis) {
    if (!/^\d{5,15}$/.test(String(gameId || ''))) {
      throw new Error('Invalid game ID');
    }

    if (!analysis || typeof analysis.league !== 'string') {
      throw new Error('Invalid analysis');
    }

    let saved = 0;

    for (const team of analysis.teams || []) {
      if (!team.available) continue;

      await pool.query(`
        INSERT INTO team_analytics (
          league,
          game_id,
          team_name,
          points,
          estimated_possessions,
          offensive_rating,
          effective_fg_percentage,
          turnover_rate,
          data
        )
        SELECT
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
        WHERE NOT EXISTS (
          SELECT 1
          FROM team_analytics
          WHERE league = $1
            AND game_id = $2
            AND team_name = $3
            AND data = $9::jsonb
        )
      `, [
        analysis.league,
        String(gameId),
        team.team,
        team.points,
        team.estimatedPossessions,
        team.offensiveRating,
        team.effectiveFGPercentage,
        team.turnoverRate,
        JSON.stringify(team)
      ]);

      saved++;
    }

    return {
      processedTeams: saved
    };
  }

  async function getGameHistory(league, gameId) {
    const result = await pool.query(`
      SELECT
        team_name,
        observed_at,
        points,
        estimated_possessions,
        offensive_rating,
        effective_fg_percentage,
        turnover_rate
      FROM team_analytics
      WHERE league = $1 AND game_id = $2
      ORDER BY observed_at ASC, id ASC
      LIMIT 1000
    `, [league, String(gameId)]);

    return result.rows;
  }

  return {
    init,
    save,
    getGameHistory
  };
}

module.exports = {
  createAnalyticsStore
};
