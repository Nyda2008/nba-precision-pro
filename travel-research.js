
'use strict';

// Basketball Precision Pro — NCAA Travel Research v2
// Read-only. Does not modify scoring projections or betting rules.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';

const SLUGS = {
  ncaam: 'mens-college-basketball',
  ncaaw: 'womens-college-basketball'
};

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia'
};

const locationCache = new Map();

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error('Data source HTTP ' + response.status);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/\./g, '').replace(/\s+/g, ' ');
}

function fullState(value) {
  const key = String(value || '').trim().toUpperCase();
  return STATE_NAMES[key] || String(value || '').trim();
}

function dateOnly(value) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 10)
    : null;
}

function daysBetween(later, earlier) {
  if (!later || !earlier) return null;
  return Math.round((
    Date.parse(later + 'T00:00:00Z') -
    Date.parse(earlier + 'T00:00:00Z')
  ) / 86400000);
}

function locationFromVenue(venue) {
  const address = venue?.address || {};
  return {
    venueName: venue?.fullName || venue?.name || null,
    city: address.city || null,
    state: address.state || null,
    country: address.country || 'USA'
  };
}

function validUSPlace(place) {
  if (!place?.city || !place?.state) return false;
  const country = normalize(place.country || 'USA');
  return ['usa', 'us', 'united states', 'united states of america']
    .includes(country);
}

function sameLocation(a, b) {
  return validUSPlace(a) && validUSPlace(b) &&
    normalize(a.city) === normalize(b.city) &&
    normalize(fullState(a.state)) === normalize(fullState(b.state));
}

async function coordinates(place, request = getJSON) {
  if (!validUSPlace(place)) return null;

  const state = fullState(place.state);
  const key = normalize(place.city) + '|' + normalize(state);
  if (locationCache.has(key)) return locationCache.get(key);

  // Search by city; independently verify the state.
  const url = GEO + '?' + new URLSearchParams({
    name: String(place.city).trim(),
    count: '100',
    countryCode: 'US',
    language: 'en',
    format: 'json'
  }).toString();

  try {
    const data = await request(url);
    const match = (data.results || []).find(item =>
      normalize(item.name) === normalize(place.city) &&
      normalize(item.admin1) === normalize(state) &&
      (item.country_code === undefined || item.country_code === 'US')
    );

    if (!match) return null;

    const latitude = Number(match.latitude);
    const longitude = Number(match.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const found = {
      latitude,
      longitude,
      timezone: match.timezone || null,
      resolvedCity: match.name,
      resolvedState: match.admin1
    };

    locationCache.set(key, found);
    return found;
  } catch {
    return null;
  }
}

function greatCircleMiles(a, b) {
  if (!a || !b) return null;

  const rad = degrees => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);

  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) *
    Math.sin(dLon / 2) ** 2;

  const bounded = Math.max(0, Math.min(1, value));

  return Math.round(
    3958.7613 * 2 * Math.asin(Math.sqrt(bounded))
  );
}

async function distanceBetweenPlaces(a, b, request = getJSON) {
  if (!validUSPlace(a) || !validUSPlace(b)) return null;
  if (sameLocation(a, b)) return 0;

  const [start, end] = await Promise.all([
    coordinates(a, request),
    coordinates(b, request)
  ]);

  return greatCircleMiles(start, end);
}

function parseEvent(event) {
  const competition = event.competitions?.[0] || {};

  return {
    id: String(event.id || ''),
    date: dateOnly(event.date),
    completed: event.status?.type?.completed === true ||
      event.status?.type?.name === 'STATUS_FINAL',
    location: locationFromVenue(competition.venue),
    teams: (competition.competitors || []).map(c => ({
      id: String(c.team?.id || ''),
      homeAway: c.homeAway || null
    }))
  };
}

function teamParticipation(event, teamId) {
  return event.teams.find(
    team => team.id === String(teamId)
  ) || null;
}

async function analyzeTravel(options = {}) {
  const {
    league = 'ncaam',
    gameId,
    request = getJSON
  } = options;

  const slug = SLUGS[league];

  if (!slug) {
    throw new Error('League must be ncaam or ncaaw.');
  }

  if (!/^\d{5,15}$/.test(String(gameId || ''))) {
    throw new Error('A valid ESPN game ID is required.');
  }

  const root = ESPN + '/' + slug;

  const summary = await request(
    root + '/summary?event=' + gameId
  );

  const competition = summary.header?.competitions?.[0];

  if (!competition) {
    throw new Error('Game summary unavailable.');
  }

  const gameDate = dateOnly(
    competition.date || summary.header?.date
  );

  if (!gameDate) {
    throw new Error('Game date unavailable.');
  }

  const currentLocation = locationFromVenue(
    summary.gameInfo?.venue || competition.venue
  );

  const teams = (competition.competitors || []).map(c => ({
    id: String(c.team?.id || ''),
    name: c.team?.displayName || null,
    homeAway: c.homeAway || null
  }));

  const previousGames = [];
  const unavailableDates = [];
  const seenGames = new Set();

  for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
    const date = new Date(
      Date.parse(gameDate + 'T00:00:00Z') -
      daysAgo * 86400000
    ).toISOString().slice(0, 10);

    try {
      const data = await request(
        root + '/scoreboard?dates=' +
        date.replace(/-/g, '') +
        '&groups=50&limit=500'
      );

      for (const event of data.events || []) {
        const parsed = parseEvent(event);

        if (
          !parsed.completed ||
          !parsed.date ||
          parsed.date >= gameDate ||
          seenGames.has(parsed.id)
        ) {
          continue;
        }

        seenGames.add(parsed.id);
        previousGames.push(parsed);
      }
    } catch (error) {
      unavailableDates.push({
        date,
        error: error.message
      });
    }
  }

  const results = [];

  for (const team of teams) {
    const history = previousGames
      .filter(event =>
        teamParticipation(event, team.id)
      )
      .sort((a, b) =>
        b.date.localeCompare(a.date)
      );

    const previous = history[0] || null;

    const elapsed = previous
      ? daysBetween(gameDate, previous.date)
      : null;

    const travelMiles = previous
      ? await distanceBetweenPlaces(
          previous.location,
          currentLocation,
          request
        )
      : null;

    const route = [...history].reverse().map(event => ({
      gameId: event.id,
      date: event.date,
      location: event.location
    }));

    route.push({
      gameId: String(gameId),
      date: gameDate,
      location: currentLocation
    });

    let knownMiles = 0;
    let knownLegs = 0;
    let unknownLegs = 0;

    for (let i = 1; i < route.length; i++) {
      const miles = await distanceBetweenPlaces(
        route[i - 1].location,
        route[i].location,
        request
      );

      if (miles === null) {
        unknownLegs++;
      } else {
        knownMiles += miles;
        knownLegs++;
      }
    }

    const roadGames = history.filter(event =>
      teamParticipation(event, team.id)?.homeAway === 'away'
    ).length;

    results.push({
      teamId: team.id,
      team: team.name,
      currentHomeAway: team.homeAway,
      currentVenue: currentLocation,
      previousGame: previous ? {
        gameId: previous.id,
        date: previous.date,
        venue: previous.location
      } : null,
      rest: {
        daysSincePreviousGame: elapsed,
        calendarRestDays: elapsed === null
          ? null
          : Math.max(0, elapsed - 1),
        shortRest: elapsed === null
          ? null
          : elapsed <= 1
      },
      travel: {
        milesFromPreviousVenue: travelMiles,
        knownRouteMilesInWindow: knownMiles,
        knownRouteLegs: knownLegs,
        unknownRouteLegs: unknownLegs,
        routeDistanceComplete:
          unknownLegs === 0 &&
          route.length > 1 &&
          unavailableDates.length === 0,
        awayGamesInPriorSevenDays: roadGames,
        gamesInPriorSevenDays: history.length,
        measurement: 'Estimated straight-line city-to-city miles'
      }
    });
  }

  return {
    module: 'travel-research-v2',
    league,
    gameId: String(gameId),
    gameDate,
    retrievedAt: new Date().toISOString(),
    currentVenue: currentLocation,
    teams: results,
    dataCoverage: {
      daysRequested: 7,
      datesUnavailable: unavailableDates
    },
    notes: [
      'Distances are approximate city-center straight-line miles, not actual travel.',
      'States are matched against full state names to avoid wrong-city results.',
      'Unknown distances remain null; known route miles may be incomplete.',
      'Historical games are limited to seven preceding UTC calendar dates.',
      'Travel fatigue has not been established as a betting advantage.',
      'No scoring model or halftime OVER rule is changed.'
    ]
  };
}

module.exports = {
  analyzeTravel,
  greatCircleMiles,
  distanceBetweenPlaces,
  locationFromVenue
};
