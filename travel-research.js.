
'use strict';

// Basketball Precision Pro
// NCAA Travel Research — Version 1
// Read-only. Does not modify projections or betting decisions.

const ESPN =
  'https://site.api.espn.com/apis/site/v2/sports/basketball';

const SLUGS = {
  ncaam: 'mens-college-basketball',
  ncaaw: 'womens-college-basketball'
};

const locationCache = new Map();

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Data source HTTP ' + response.status);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
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
  const city = address.city || null;
  const state = address.state || null;

  return {
    venueName: venue?.fullName || venue?.name || null,
    city,
    state,
    country: address.country || 'USA'
  };
}

function sameLocation(a, b) {
  if (!a?.city || !b?.city) return false;

  return (
    String(a.city).toLowerCase() ===
      String(b.city).toLowerCase() &&
    String(a.state || '').toLowerCase() ===
      String(b.state || '').toLowerCase()
  );
}

async function coordinates(place, request = getJSON) {
  if (!place?.city || !place?.state) return null;

  const country = String(place.country || 'USA')
    .toUpperCase();

  if (!['USA', 'US', 'UNITED STATES'].includes(country)) {
    return null;
  }

  const key = [
    place.city.toLowerCase(),
    place.state.toLowerCase()
  ].join('|');

  if (locationCache.has(key)) {
    return locationCache.get(key);
  }

  const name = place.city + ', ' + place.state;

  const url =
    'https://geocoding-api.open-meteo.com/v1/search?' +
    new URLSearchParams({
      name,
      count: '10',
      countryCode: 'US',
      language: 'en',
      format: 'json'
    }).toString();

  try {
    const data = await request(url);

    const results = data.results || [];

    const normalized = value =>
      String(value || '').trim().toLowerCase();

    const match = results.find(item => {
      const cityMatches =
        normalized(item.name) === normalized(place.city);

      const stateMatches =
        normalized(item.admin1) === normalized(place.state) ||
        normalized(item.admin1_code) === normalized(place.state);

      return cityMatches && stateMatches;
    });

    // Do not accept a location in the wrong state.
    // Some state abbreviations require explicit verification.
    if (!match) return null;

    const latitude = Number(match.latitude);
    const longitude = Number(match.longitude);

    if (!Number.isFinite(latitude) ||
        !Number.isFinite(longitude)) return null;

    const value = {
      latitude,
      longitude,
      timezone: match.timezone || null,
      resolvedCity: match.name,
      resolvedState: match.admin1
    };

    locationCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

function greatCircleMiles(a, b) {
  if (!a || !b) return null;

  const rad = degrees => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);

  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
    Math.cos(rad(b.latitude)) *
    Math.sin(dLon / 2) ** 2;

  const angle = 2 * Math.atan2(
    Math.sqrt(Math.min(1, value)),
    Math.sqrt(Math.max(0, 1 - value))
  );

  return Math.round(3958.7613 * angle);
}

async function distanceBetweenPlaces(a, b, request) {
  if (!a?.city || !b?.city) return null;

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
    status: event.status?.type?.name || null,
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

      previousGames.push(
        ...(data.events || [])
          .map(parseEvent)
          .filter(event =>
            event.completed &&
            event.date &&
            event.date < gameDate
          )
      );
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
      .filter(event => teamParticipation(event, team.id))
      .sort((a, b) => b.date.localeCompare(a.date));

    const previous = history[0] || null;

    const elapsed = previous
      ? daysBetween(gameDate, previous.date)
      : null;

    const travelMiles = previous
      ? await distanceBetweenPlaces(
          previous.location, currentLocation, request
        )
      : null;

    // Construct the sequence in chronological order.
    // Include the current game as the final location.
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

    const roadGames = history.filter(event => {
      const participation = teamParticipation(
        event, team.id
      );
      return participation?.homeAway === 'away';
    }).length;

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
          unknownLegs === 0 && route.length > 1,
        awayGamesInPriorSevenDays: roadGames,
        gamesInPriorSevenDays: history.length,
        measurement: 'Estimated straight-line miles'
      }
    });
  }

  return {
    module: 'travel-research-v1',
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
      'Venue-to-venue estimates are not actual team routes.',
      'Location coordinates represent cities, not arenas.',
      'A missing venue or failed geocode produces null.',
      'Unknown route legs are excluded from known miles.',
      'Seven-day history may omit earlier games.',
      'No player fatigue or betting edge is inferred.',
      'Existing analyzer and OVER filter are unchanged.'
    ]
  };
}

module.exports = {
  analyzeTravel,
  greatCircleMiles,
  distanceBetweenPlaces,
  locationFromVenue
};
