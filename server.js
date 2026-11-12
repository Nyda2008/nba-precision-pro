
    // READ-ONLY HISTORICAL RESEARCH
    // Supports NCAAM, NCAAW, NBA and WNBA.

    if (u.pathname === '/api/backtest/research') {
      const league =
        u.searchParams.get('league') || 'ncaam';

      if (!validLeague(league)) {
        return send(res, 400, {
          error: 'Unsupported league'
        });
      }

      const research =
        await backtestStore.getHistoricalResearch(league);

      return send(res, 200, research);
    }

