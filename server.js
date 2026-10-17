
      const date = u.searchParams.get('date');
      let events;

      if (date !== null) {
        if (!/^\d{8}$/.test(date)) {
          return send(res, 400, {
            error: 'Date must be in YYYYMMDD format'
          });
        }

        const year = Number(date.slice(0, 4));
        const month = Number(date.slice(4, 6));
        const day = Number(date.slice(6, 8));
        const parsed = new Date(Date.UTC(year, month - 1, day));

        if (
          year < 100 ||
          parsed.getUTCFullYear() !== year ||
          parsed.getUTCMonth() !== month - 1 ||
          parsed.getUTCDate() !== day
        ) {
          return send(res, 400, {
            error: 'Invalid calendar date'
          });
        }

        const data = await getJSON(
          'games:' + league.id + ':' + date,
          ESPN + '/' + league.id + '/scoreboard?dates=' + date,
          60000
        );

        events = (data.events || []).map(e =>
          parseEvent(e, league.id)
        );

        await storeGames(events);
      } else {
        events = await loadGames(league.id);
      }
