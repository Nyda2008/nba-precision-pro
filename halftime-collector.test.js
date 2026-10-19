
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createHalftimeCollector,
  buildHalftimeInput
} = require('./halftime-collector');

function sampleSummary() {
  return {
    header: {
      competitions: [
        {
          status: {
            type: {
              name: 'STATUS_HALFTIME',
              description: 'Halftime',
              completed: false
            }
          },
          competitors: [
            {
              team: {
                id: '101',
                displayName: 'Away Team'
              },
              homeAway: 'away',
              score: '58',
              linescores: [
                { period: 1, value: 28 },
                { period: 2, value: 30 }
              ]
            },
            {
              team: {
                id: '102',
                displayName: 'Home Team'
              },
              homeAway: 'home',
              score: '54',
              linescores: [
                { period: 1, value: 25 },
                { period: 2, value: 29 }
              ]
            }
          ]
        }
      ]
    },
    boxscore: {
      players: [
        {
          team: { id: '101' },
          statistics: [
            {
              labels: [
                'FG', '3PT', 'FT',
                'OREB', 'TO', 'PTS'
              ],
              totals: [
                '22-45', '8-20', '6-8',
                '5', '6', '58'
              ]
            }
          ]
        },
        {
          team: { id: '102' },
          statistics: [
            {
              labels: [
                'FG', '3PT', 'FT',
                'OREB', 'TO', 'PTS'
              ],
              totals: [
                '20-44', '6-18', '8-10',
                '5', '7', '54'
              ]
            }
          ]
        }
      ]
    }
  };
}

function createMockStore() {
  const records = [];

  return {
    records,

    async savePrediction(record) {
      const exists = records.some(saved =>
        saved.league === record.league &&
        saved.gameId === record.gameId &&
        saved.modelVersion === record.modelVersion
      );

      if (exists) {
        return { inserted: false };
      }

      records.push(structuredClone(record));

      return { inserted: true };
    }
  };
}

function captureInput(overrides = {}) {
  return {
    league: 'nba',
    gameId: '401900001',
    summary: sampleSummary(),
    observedAt: new Date(
      Date.now() - 60000
    ).toISOString(),
    ...overrides
  };
}

test('Recognizes valid halftime data', () => {
  const result = buildHalftimeInput(
    sampleSummary()
  );

  assert.ok(result.input);
  assert.equal(
    result.input.snapshotPeriod,
    'halftime'
  );
  assert.equal(result.input.teams.length, 2);
});

test('Calculates correct first-half scores', () => {
  const result = buildHalftimeInput(
    sampleSummary()
  );

  const away = result.input.teams.find(
    team => team.homeAway === 'away'
  );

  const home = result.input.teams.find(
    team => team.homeAway === 'home'
  );

  assert.equal(away.firstHalfPoints, 58);
  assert.equal(home.firstHalfPoints, 54);

  assert.equal(
    away.firstHalfPoints + home.firstHalfPoints,
    112
  );
});

test('Matches box scores by team ID', () => {
  const summary = sampleSummary();

  summary.boxscore.players.reverse();

  const result = buildHalftimeInput(summary);

  assert.ok(result.input);

  const away = result.input.teams.find(
    team => team.homeAway === 'away'
  );

  const home = result.input.teams.find(
    team => team.homeAway === 'home'
  );

  assert.equal(away.stats.PTS, '58');
  assert.equal(home.stats.PTS, '54');
  assert.equal(away.stats.FG, '22-45');
  assert.equal(home.stats.FG, '20-44');
});

test('Rejects games that are not at halftime', () => {
  const summary = sampleSummary();

  summary.header.competitions[0].status.type = {
    name: 'STATUS_IN_PROGRESS',
    description: 'End of 3rd Quarter',
    completed: false
  };

  const result = buildHalftimeInput(summary);

  assert.equal(result.input, undefined);
  assert.match(result.reason, /halftime/i);
});

test('Rejects completed games', () => {
  const summary = sampleSummary();

  summary.header.competitions[0].status.type.completed = true;

  const result = buildHalftimeInput(summary);

  assert.equal(result.input, undefined);
});

test('Rejects incorrect halftime scores', () => {
  const summary = sampleSummary();

  summary.header.competitions[0].competitors[0].score = '60';

  const result = buildHalftimeInput(summary);

  assert.equal(result.input, undefined);
  assert.ok(result.reason);
});

test('Rejects mismatched box-score points', () => {
  const summary = sampleSummary();

  summary.boxscore.players[0].statistics[0].totals[5] = '100';

  const result = buildHalftimeInput(summary);

  assert.equal(result.input, undefined);
  assert.match(result.reason, /box-score/i);
});

test('Rejects incomplete halftime periods', () => {
  const summary = sampleSummary();

  summary.header.competitions[0].competitors[0]
    .linescores.pop();

  const result = buildHalftimeInput(summary);

  assert.equal(result.input, undefined);
});

test('Generates and saves advanced predictions', async () => {
  const store = createMockStore();

  const collector = createHalftimeCollector({
    store
  });

  const result = await collector.capture(
    captureInput()
  );

  assert.equal(result.status, 'saved');
  assert.equal(store.records.length, 1);

  const saved = store.records[0];

  assert.equal(
    saved.modelVersion,
    'experimental-possession-v1'
  );

  assert.equal(
    saved.inputSnapshot.snapshotPeriod,
    'halftime'
  );

  assert.equal(
    saved.prediction.modelUsed,
    'experimental-possession-v1'
  );

  assert.ok(
    Number.isFinite(
      saved.prediction.prediction.projectedSecondHalfTotal
    )
  );

  assert.ok(
    Number.isFinite(
      saved.prediction.prediction.projectedFinalTotal
    )
  );

  assert.ok(
    saved.prediction.prediction.projectedSecondHalfResult
  );

  assert.ok(
    saved.prediction.prediction.projectedFinalResult
  );
});

test('Prevents duplicate predictions', async () => {
  const store = createMockStore();

  const collector = createHalftimeCollector({
    store
  });

  const input = captureInput();

  const first = await collector.capture(input);

  const second = await collector.capture(input);

  assert.equal(first.status, 'saved');

  assert.equal(
    second.status,
    'already-saved'
  );

  assert.equal(store.records.length, 1);
});

test('Supports NBA and WNBA but rejects other leagues', async () => {
  const store = createMockStore();

  const collector = createHalftimeCollector({
    store
  });

  const wnba = await collector.capture(
    captureInput({
      league: 'wnba',
      gameId: '401900002'
    })
  );

  assert.equal(wnba.status, 'saved');

  const unsupported = await collector.capture(
    captureInput({
      league: 'cibapac'
    })
  );

  assert.equal(unsupported.status, 'skipped');

  assert.equal(store.records.length, 1);
});

test('Rejects invalid IDs, timestamps and unavailable inputs', async () => {
  const store = createMockStore();

  const collector = createHalftimeCollector({
    store
  });

  const badId = await collector.capture(
    captureInput({ gameId: 'invalid' })
  );

  assert.equal(badId.status, 'skipped');

  const future = await collector.capture(
    captureInput({
      observedAt: new Date(
        Date.now() + 3600000
      ).toISOString()
    })
  );

  assert.equal(future.status, 'skipped');

  const incomplete = sampleSummary();

  incomplete.boxscore.players = [];

  const missing = await collector.capture(
    captureInput({ summary: incomplete })
  );

  assert.equal(missing.status, 'skipped');

  const final = sampleSummary();

  final.header.competitions[0].status.type.completed = true;

  const completed = await collector.capture(
    captureInput({ summary: final })
  );

  assert.equal(completed.status, 'skipped');

  assert.equal(store.records.length, 0);
});
