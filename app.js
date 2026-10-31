/**
 * Analisador de Inimigos Dota 2 - Coach Draft Advisor
 * Consome a API pública do OpenDota e calcula o Score de Confiança Ponderado.
 */

// Estado global da aplicação
const state = {
  heroes: {}, // Mapa id -> objeto hero
  accountId: '',
  profile: null,
  rawMatches: [],
  periodMatches: [],
  heroStats: [],
  selectedMonths: 9,
  matchesLimit: 200,
  searchQuery: '',
  attrFilter: 'all',
  posFilter: 'all', // 'all', '1', '2', '3', '4', '5'
  lobbyFilter: 'all', // 'all', 'tournament', 'ranked'
  minGamesFilter: 5,
  penalizeInactive: true, // Prioriza ritmo recente e penaliza heróis parados há meses
  sortBy: 'score',
  sortAsc: false,
  isLoading: false,
  selectedHeroForModal: null
};

const teamState = {
  players: [],
  heroes: [],
  scoreMode: 'strict',
  months: 9,
  loading: false
};

const TEAM_FLEX_MIN_SCORE = 60;
const matchPositionCache = new Map();
const MAX_POSITION_DETAIL_LOOKUPS = 25;
const rdcState = { selectedIds: new Set() };

// Mapeamento competitivo oficial das posições de 1 a 5 no Dota 2
// 1 = Safe Carry, 2 = Mid, 3 = Offlane, 4 = Soft Support, 5 = Hard Support
const HERO_POSITIONS_MAP = {
  1: [1], 2: [3], 3: [5], 4: [1, 3], 5: [5], 6: [1], 7: [3, 4], 8: [1], 9: [4, 2], 10: [1, 2],
  11: [2], 12: [1], 13: [2], 14: [3, 4], 15: [1, 2, 3], 16: [3, 4], 17: [2], 18: [1, 3], 19: [2, 4, 1], 20: [5, 4],
  21: [2, 4], 22: [2, 4], 23: [2, 3], 25: [2, 1], 26: [4, 5], 27: [5, 4], 28: [3], 29: [3], 30: [5],
  31: [5], 32: [4, 1], 33: [3, 4], 34: [2, 4], 35: [2, 1], 36: [2, 3], 37: [5], 38: [3], 39: [2], 40: [3, 4, 5],
  41: [1], 42: [1, 3], 43: [2, 3], 44: [1], 45: [4, 5], 46: [2, 1], 47: [2, 3], 48: [1], 49: [2, 3, 1], 50: [5, 2],
  51: [4, 3], 52: [2, 1], 53: [4, 5, 3], 54: [1], 55: [3], 56: [2, 1, 4], 57: [3, 5], 58: [5], 59: [2], 60: [3],
  61: [3, 2], 62: [4], 63: [1, 4], 64: [5], 65: [3, 2, 4], 66: [5], 67: [1], 68: [5, 4], 69: [3], 70: [1],
  71: [4, 3], 72: [1, 4], 73: [1, 2], 74: [2], 75: [5, 4, 2], 76: [2], 77: [3, 1], 78: [3, 2], 79: [5, 4], 80: [1, 2],
  81: [1, 3], 82: [2, 1], 83: [5, 3], 84: [5, 3], 85: [5, 3], 86: [4], 87: [5], 88: [4, 3], 89: [1, 5], 90: [4, 5],
  91: [5, 4], 92: [3, 4], 93: [1], 94: [1], 95: [1], 96: [3], 97: [3, 2], 98: [3, 2], 99: [3, 1], 100: [4, 3],
  101: [4, 5, 2], 102: [5, 3], 103: [4, 5], 104: [3], 105: [4, 2], 106: [2], 107: [4, 2], 108: [3], 109: [1], 110: [4, 3, 5],
  111: [5], 112: [5], 113: [1, 2], 114: [1, 2, 4], 119: [4, 5], 120: [2, 3], 121: [5, 4], 123: [4], 126: [2], 128: [4, 5, 2],
  129: [3], 131: [4, 5], 135: [3, 2], 136: [1, 4, 3], 137: [3, 2], 138: [1, 4], 145: [1, 2], 155: [3, 4]
};

// URL padrão das imagens dos heróis (Steam CDN)
const STEAM_HERO_IMG_CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/';

// Tiers de Rank do Dota 2 (OpenDota rank_tier: 11 = Herald 1, ..., 80 = Immortal)
const RANK_NAMES = {
  1: 'Herald (Arauto)',
  2: 'Guardian (Guardião)',
  3: 'Crusader (Cruzado)',
  4: 'Archon (Arconte)',
  5: 'Legend (Lenda)',
  6: 'Ancient (Ancestral)',
  7: 'Divine (Divino)',
  8: 'Immortal (Imortal)'
};

/**
 * Inicialização ao carregar a página
 */
document.addEventListener('DOMContentLoaded', async () => {
  initHeroesCache();
  setupEventListeners();
  checkUrlParams();
});

/**
 * Carrega a base de heróis
 */
async function initHeroesCache() {
  // Usa fallback local imediatamente para velocidade instantânea
  if (window.DOTA_HEROES_FALLBACK && Array.isArray(window.DOTA_HEROES_FALLBACK)) {
    buildHeroesMap(window.DOTA_HEROES_FALLBACK);
  }

  // Tenta sincronizar com a API oficial do OpenDota em background
  try {
    const res = await fetch('https://api.opendota.com/api/heroes');
    if (res.ok) {
      const data = await res.json();
      buildHeroesMap(data);
    }
  } catch (err) {
    console.warn('Usando base local de heróis como fallback:', err);
  }
}

function buildHeroesMap(heroesList) {
  state.heroes = {};
  heroesList.forEach(h => {
    state.heroes[h.id] = h;
  });
}

/**
 * Configura eventos dos elementos da interface
 */
function setupEventListeners() {
  const form = document.getElementById('search-form');
  const accountInput = document.getElementById('account-id-input');
  const searchBtn = document.getElementById('search-btn');

  setupTeamEventListeners();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch();
  });

  // Filtros rápidos de jogadores conhecidos
  document.querySelectorAll('.sample-player-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      accountInput.value = id;
      handleSearch();
    });
  });

  // Controles de configuração de busca
  document.getElementById('period-select').addEventListener('change', (e) => {
    state.selectedMonths = parseFloat(e.target.value);
    if (state.rawMatches.length > 0) {
      processMatchesData();
      renderAll();
    }

  });

  document.getElementById('limit-select').addEventListener('change', (e) => {
    state.matchesLimit = parseInt(e.target.value, 10);
  });

  const lobbySelect = document.getElementById('lobby-select');
  if (lobbySelect) {
    lobbySelect.addEventListener('change', (e) => {
      state.lobbyFilter = e.target.value;
      if (state.rawMatches.length > 0) {
        processMatchesData();
        renderAll();
      }
    });
  }

  // Checkboxes de Priorizar Ritmo / Penalizar Inatividade (sincronizados)
  const inactiveSearchToggle = document.getElementById('penalize-inactive-search-toggle');
  const inactiveTableToggle = document.getElementById('penalize-inactive-table-toggle');

  function syncInactiveToggles(isChecked) {
    state.penalizeInactive = isChecked;
    if (inactiveSearchToggle) inactiveSearchToggle.checked = isChecked;
    if (inactiveTableToggle) inactiveTableToggle.checked = isChecked;
    if (state.rawMatches.length > 0) {
      processMatchesData();
      renderAll();
    }
  }

  if (inactiveSearchToggle) {
    inactiveSearchToggle.addEventListener('change', (e) => syncInactiveToggles(e.target.checked));
  }
  if (inactiveTableToggle) {
    inactiveTableToggle.addEventListener('change', (e) => syncInactiveToggles(e.target.checked));
  }

  // Filtros de Posição (1-5) via Pills
  document.querySelectorAll('.pos-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pos = btn.getAttribute('data-pos');
      state.posFilter = pos;

      // Atualiza visual ativo dos botões
      document.querySelectorAll('.pos-pill-btn').forEach(b => {
        b.classList.remove('bg-red-600', 'text-white', 'shadow-md');
        b.classList.add('bg-slate-900', 'text-slate-300');
      });
      btn.classList.remove('bg-slate-900', 'text-slate-300');
      btn.classList.add('bg-red-600', 'text-white', 'shadow-md');

      renderTable();
      renderSummaryCards();
    });
  });

  // Filtros da tabela
  document.getElementById('table-search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderTable();
  });

  document.getElementById('attr-filter-select').addEventListener('change', (e) => {
    state.attrFilter = e.target.value;
    renderTable();
  });

  document.getElementById('min-games-select').addEventListener('change', (e) => {
    state.minGamesFilter = parseInt(e.target.value, 10);
    renderTable();
  });

  // Botões de exportação
  document.getElementById('copy-discord-btn').addEventListener('click', copyDiscordReport);
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('print-report-btn').addEventListener('click', () => window.print());

  // Ordenação de colunas da tabela
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const sortField = th.getAttribute('data-sort');
      if (state.sortBy === sortField) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortBy = sortField;
        state.sortAsc = false;
      }
      updateSortIndicators();
      renderTable();
    });
  });

  // Modal de partidas do herói
  const modal = document.getElementById('matches-modal');
  document.getElementById('close-modal-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function setupTeamEventListeners() {
    const individualTab = document.getElementById('individual-tab-btn');
    const teamTab = document.getElementById('team-tab-btn');
    const rdcTab = document.getElementById('rdc-tab-btn');
    individualTab.addEventListener('click', () => setAnalysisTab('individual'));
    teamTab.addEventListener('click', () => setAnalysisTab('team'));
    rdcTab.addEventListener('click', () => setAnalysisTab('rdc'));
    document.getElementById('team-search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      handleTeamSearch();
    });
    document.getElementById('team-score-mode').addEventListener('change', (e) => {
      teamState.scoreMode = e.target.value;
      if (teamState.players.length > 0) renderTeamResults();
    });
    setupRdcPlayerSelector();
}

function setAnalysisTab(tab) {
    const tabs = ['individual', 'team', 'rdc'];
    tabs.forEach(name => {
      document.getElementById(`${name}-tab-content`).classList.toggle('hidden', name !== tab);
      document.getElementById(`${name}-tab-btn`).classList.toggle('active', name === tab);
    });
}

function setupRdcPlayerSelector() {
  const filterInput = document.getElementById('rdc-player-filter');
  filterInput.addEventListener('input', () => renderRdcPlayers(filterInput.value));
  document.getElementById('rdc-analyze-btn').addEventListener('click', analyzeSelectedRdcPlayers);
  renderRdcPlayers();
}

function renderRdcPlayers(filter = '') {
  const normalizedFilter = filter.toLowerCase().trim();
  const selectedIds = getSelectedRdcIds();
  const groupedTeams = (window.RDC_PLAYERS || []).filter(player => {
    const searchable = `${player[0]} ${player[1]} ${player[2]}`.toLowerCase();
    return !normalizedFilter || searchable.includes(normalizedFilter);
  }).reduce((teams, player) => {
    const team = player[1];
    if (!teams.has(team)) teams.set(team, []);
    teams.get(team).push(player);
    return teams;
  }, new Map());
  const list = document.getElementById('rdc-player-list');
  list.innerHTML = groupedTeams.size ? Array.from(groupedTeams.entries())
    .sort(([teamA], [teamB]) => teamA.localeCompare(teamB, 'pt-BR'))
    .map(([team, players]) => `
      <section class="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-slate-800">
          <h3 class="font-bold text-slate-100 font-dota tracking-wide">${escapeHtml(team)}</h3>
          <span class="text-[11px] text-slate-500">${players.length} jogador(es)</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 p-2">
          ${players.map(([name, , id]) => `
            <label class="flex items-center gap-3 p-3 rounded-lg bg-slate-950/50 border border-slate-800 hover:border-slate-600 cursor-pointer transition">
              <input type="checkbox" class="rdc-player-checkbox w-4 h-4 rounded text-red-600 bg-slate-800 border-slate-600 focus:ring-red-500" value="${id}" data-name="${escapeHtml(name)}" ${selectedIds.has(id) ? 'checked' : ''}>
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-slate-100 truncate">${escapeHtml(name)}</span>
                <span class="block text-[11px] text-slate-500 font-mono">${id}</span>
              </span>
            </label>`).join('')}
        </div>
      </section>`).join('') : '<p class="text-sm text-slate-400 text-center py-8">Nenhum jogador ou time encontrado.</p>';

  list.querySelectorAll('.rdc-player-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', handleRdcSelectionChange);
  });
  updateRdcSelectionSummary();
}

function getSelectedRdcIds() {
  return new Set(rdcState.selectedIds);
}

function handleRdcSelectionChange(event) {
  if (event.target.checked) {
    rdcState.selectedIds.add(event.target.value);
  } else {
    rdcState.selectedIds.delete(event.target.value);
  }
  if (rdcState.selectedIds.size > 5) {
    event.target.checked = false;
    rdcState.selectedIds.delete(event.target.value);
    document.getElementById('rdc-selection-message').textContent = 'Limite máximo de 5 jogadores atingido.';
  }
  updateRdcSelectionSummary();
}

function updateRdcSelectionSummary() {
  const count = getSelectedRdcIds().size;
  document.getElementById('rdc-selection-count').textContent = `${count}/5 selecionados`;
  if (count > 0 && count < 5) {
    document.getElementById('rdc-selection-message').textContent = `Selecione mais ${5 - count} jogador(es).`;
  } else if (count === 5) {
    document.getElementById('rdc-selection-message').textContent = 'Seleção completa. Pronto para análise.';
  }
}

function analyzeSelectedRdcPlayers() {
  const selectedIds = getSelectedRdcIds();
  if (selectedIds.size !== 5) {
    document.getElementById('rdc-selection-message').textContent = 'Selecione exatamente 5 jogadores.';
    return;
  }

  const selectedPlayers = (window.RDC_PLAYERS || []).filter(player => selectedIds.has(player[2]));
  selectedPlayers.forEach(([name, , id], index) => {
    document.getElementById(`team-nickname-${index + 1}`).value = name;
    document.getElementById(`team-id-${index + 1}`).value = id;
  });
  for (let index = selectedPlayers.length; index < 5; index += 1) {
    document.getElementById(`team-nickname-${index + 1}`).value = '';
    document.getElementById(`team-id-${index + 1}`).value = '';
  }

  setAnalysisTab('team');
  handleTeamSearch();
}

/**
 * Permite passar o ID por URL (ex: ?id=70388657)
 */
function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  if (id) {
    document.getElementById('account-id-input').value = id;
    handleSearch();
  }
}

/**
 * Executa a busca do jogador
 */
async function handleSearch() {
  const rawInput = document.getElementById('account-id-input').value.trim();
  const cleanId = extractAccountId(rawInput);

  if (!cleanId) {
    showError('Por favor, informe um Account ID (Friend ID ou SteamID32) válido com apenas números.');
    return;
  }

  state.accountId = cleanId;
  setLoading(true);
  hideError();
  hideDashboard();

  try {
    // Busca dados em paralelo do jogador e partidas
    const [profileRes, matchesRes] = await Promise.all([
      fetch(`https://api.opendota.com/api/players/${cleanId}`),
      fetch(`https://api.opendota.com/api/players/${cleanId}/matches?limit=${state.matchesLimit}`)
    ]);

    if (!profileRes.ok || !matchesRes.ok) {
      if (profileRes.status === 404 || matchesRes.status === 404) {
        throw new Error('Jogador não encontrado. Verifique o Account ID informado.');
      } else if (profileRes.status === 429 || matchesRes.status === 429) {
        throw new Error('Limite de requisições do OpenDota atingido temporariamente. Aguarde alguns instantes e tente novamente.');
      } else {
        throw new Error(`Erro na API do OpenDota (${profileRes.status}/${matchesRes.status}).`);
      }
    }

    const profileData = await profileRes.json();
    const matchesData = await matchesRes.json();

    if (!Array.isArray(matchesData) || matchesData.length === 0) {
      throw new Error('Nenhuma partida encontrada para este jogador. O histórico pode estar privado nas configurações de privacidade do Dota 2 ("Expose Public Match Data").');
    }

    state.profile = profileData;
    state.rawMatches = await enrichMatchesWithPositions(matchesData, cleanId);

    processMatchesData();
    renderAll();
    showDashboard();

  } catch (err) {
    console.error(err);
    showError(err.message || 'Ocorreu um erro ao consultar os dados do jogador.');
  } finally {
    setLoading(false);
  }
}

  async function handleTeamSearch() {
    const inputs = Array.from(document.querySelectorAll('.team-id-input'));
    const nicknames = Array.from(document.querySelectorAll('.team-nickname-input'));
    const ids = inputs.map(input => extractAccountId(input.value.trim()));
    const customNames = nicknames.map(input => input.value.trim());
    const error = document.getElementById('team-error-message');

    if (ids.some(id => !id)) {
      showTeamError('Informe cinco Account IDs válidos, usando apenas números ou links do jogador.');
      return;
    }
    if (new Set(ids).size !== ids.length) {
      showTeamError('Os cinco Account IDs precisam ser diferentes.');
      return;
    }

    teamState.months = parseFloat(document.getElementById('team-period-select').value);
    teamState.scoreMode = document.getElementById('team-score-mode').value;
    setTeamLoading(true);
    error.classList.add('hidden');

    try {
      const players = await Promise.all(ids.map(async (accountId, index) => {
        const [profileRes, matchesRes] = await Promise.all([
          fetch(`https://api.opendota.com/api/players/${accountId}`),
          fetch(`https://api.opendota.com/api/players/${accountId}/matches?limit=${state.matchesLimit}`)
        ]);
        if (!profileRes.ok || !matchesRes.ok) {
          throw new Error(`Não foi possível consultar o jogador ${index + 1} (${accountId}).`);
        }
        const profile = await profileRes.json();
        const matches = await matchesRes.json();
        if (!Array.isArray(matches) || matches.length === 0) {
          throw new Error(`O jogador ${index + 1} (${accountId}) não possui partidas públicas no período consultado.`);
        }
        const enrichedMatches = await enrichMatchesWithPositions(matches, accountId);
        return { accountId, profile, matches: enrichedMatches };
      }));

      const previous = {
        accountId: state.accountId,
        profile: state.profile,
        rawMatches: state.rawMatches,
        periodMatches: state.periodMatches,
        heroStats: state.heroStats,
        selectedMonths: state.selectedMonths,
        lobbyFilter: state.lobbyFilter,
        penalizeInactive: state.penalizeInactive
      };

      teamState.players = players.map((player, index) => {
        state.accountId = player.accountId;
        state.profile = player.profile;
        state.rawMatches = player.matches;
        state.selectedMonths = teamState.months;
        state.lobbyFilter = 'all';
        state.penalizeInactive = true;
        processMatchesData();
        const name = customNames[index] || player.profile?.profile?.personaname || player.profile?.profile?.name || `Player ${player.accountId}`;
        return { ...player, name, heroStats: [...state.heroStats] };
      });

      Object.assign(state, previous);
      renderTeamResults();
      document.getElementById('team-empty-state').classList.add('hidden');
      document.getElementById('team-results').classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showTeamError(err.message || 'Ocorreu um erro ao consultar a equipe.');
    } finally {
      setTeamLoading(false);
    }
  }

  function renderTeamResults() {
    const heroMap = new Map();
    teamState.players.forEach(player => {
      player.heroStats.forEach(stat => {
        if (!heroMap.has(stat.heroId)) heroMap.set(stat.heroId, { hero: stat.hero, players: [] });
        heroMap.get(stat.heroId).players.push({
          name: player.name,
          accountId: player.accountId,
          positions: stat.positions,
          score: stat.confidenceScore,
          teamScore: getTeamTemporalScore(stat),
          temporal: getTeamTemporalProfile(stat),
          games: stat.games,
          winrate: stat.winrate,
          wins: stat.wins,
          losses: stat.losses,
          tier: stat.banTier
        });
      });
    });

    const heroes = Array.from(heroMap.values()).map(item => {
      const rankedPlayers = item.players.sort((a, b) => teamState.scoreMode === 'strict'
        ? b.teamScore - a.teamScore
        : b.score - a.score);
      const players = rankedPlayers.slice(0, 1).concat(
        rankedPlayers.slice(1).filter(player => player.score >= TEAM_FLEX_MIN_SCORE)
      );
      const best = players[0];
      const score = teamState.scoreMode === 'strict'
        ? Math.min(100, Math.round((best.teamScore + Math.min(6, (players.length - 1) * 3)) * 10) / 10)
        : best.score;
      const tier = getTeamBanTier(best, score);
      return { ...item, players, best, score, tier };
    }).sort((a, b) => b.score - a.score || b.players.length - a.players.length);

    const modeLabel = teamState.scoreMode === 'strict' ? 'Régua de equipe rígida' : 'Régua individual';
    document.getElementById('team-results-subtitle').textContent =
      `${modeLabel} • ${teamState.players.length} jogadores • Últimos ${teamState.months} meses`;

    const bansList = document.getElementById('team-bans-list');
    const topHeroes = heroes.slice(0, 9);
    bansList.innerHTML = topHeroes.length ? topHeroes.map((item, index) => {
      const heroName = escapeHtml(item.hero.localized_name || `Herói #${item.hero.id}`);
      const bestName = escapeHtml(item.best.name);
      const flex = item.players.length > 1
        ? `<div class="mt-2 text-[11px] text-slate-400">Flex: ${item.players.slice(1).map(player =>
          `${escapeHtml(player.name)} • ${formatPositions(player.positions)} • ${player.score} pts`).join('<br>')}</div>`
        : '<div class="mt-2 text-[11px] text-slate-500">Apenas um jogador usa este herói.</div>';
      return `<article class="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5">
        <div class="flex items-start justify-between gap-3">
          <div><span class="text-[10px] text-slate-500">#${index + 1}</span><h3 class="font-bold text-slate-100">${heroName}</h3></div>
          <div class="text-right"><div class="text-lg font-bold text-red-400">${item.score} pts</div><span class="text-[9px] px-2 py-0.5 rounded ${item.tier.badgeClass}">${item.tier.label}</span></div>
        </div>
        <div class="mt-2 text-xs text-slate-300">Principal: <strong>${bestName}</strong> • ${formatPositions(item.best.positions)} • ${item.best.score} pts individual</div>
        <div class="mt-1 text-[11px] text-slate-500">${item.best.temporal.summary}</div>
        ${flex}
      </article>`;
    }).join('') : '<p class="text-sm text-slate-400">Nenhum herói encontrado no período.</p>';

    const sharedHeroes = heroes.filter(item => item.players.length > 1);
    const table = document.getElementById('team-flex-table');
    table.innerHTML = sharedHeroes.length ? sharedHeroes.map((item, index) => {
      const heroName = item.hero.localized_name || `Herói #${item.hero.id}`;
      const heroImg = getHeroImageUrl(item.hero.name);
      const attrBadge = getAttrBadgeHtml(item.hero.primary_attr);
      const positions = getPositionsBadgeHtml(item.best.positions);
      const playersHtml = item.players.map(player => `
        <div class="flex flex-wrap items-center gap-1.5 ${player === item.best ? 'text-slate-100' : 'text-slate-300'}">
          <span class="font-semibold">${escapeHtml(player.name)}</span>
          <span class="text-slate-600">•</span>
          <span class="flex items-center gap-1">${getPositionsBadgeHtml(player.positions)}</span>
          <span class="text-slate-500">• ${player.score} pts • ${player.games}j • ${player.winrate.toFixed(0)}% WR</span>
        </div>`).join('');
      return `<tr class="border-b border-slate-800/80 hover:bg-slate-800/40 transition-colors text-sm">
        <td class="py-3 px-3 text-center font-bold font-dota text-slate-400 whitespace-nowrap">#${index + 1}</td>
        <td class="py-3 px-3">
          <div class="flex items-center space-x-3">
            <img src="${heroImg}" alt="${escapeHtml(heroName)}" class="w-14 h-8 shrink-0 rounded aspect-video object-cover border border-slate-700/80 shadow-sm" onerror="this.src='https://via.placeholder.com/56/1e293b/ffffff?text=Dota'">
            <div class="min-w-0">
              <div class="font-semibold text-slate-100 flex items-center space-x-1.5 whitespace-nowrap"><span>${escapeHtml(heroName)}</span>${attrBadge}</div>
              <div class="text-[11px] text-slate-400 flex items-center space-x-1 mt-0.5">${positions}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-3 text-right whitespace-nowrap">
          <div class="flex flex-col items-end">
            <span class="text-base font-bold text-white font-dota tracking-wide bg-slate-900 px-2.5 py-0.5 rounded border border-slate-700">${item.score}</span>
            <span class="mt-1 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded uppercase whitespace-nowrap inline-block ${item.tier.badgeClass}">${item.tier.label}</span>
          </div>
        </td>
        <td class="py-3 px-3 text-xs leading-5">${playersHtml}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="4" class="text-center py-8 text-slate-400 text-sm">Nenhum herói flex compartilhado entre os jogadores.</td></tr>';
  }

  function getTeamTemporalProfile(stat) {
    const now = Date.now() / 1000;
    const timestamps = stat.matches.map(match => match.startTime).filter(Boolean).sort((a, b) => a - b);
    const daysAgo = timestamp => Math.max(0, (now - timestamp) / 86400);
    const recent90 = timestamps.filter(timestamp => daysAgo(timestamp) <= 90).length;
    const recent180 = timestamps.filter(timestamp => daysAgo(timestamp) <= 180).length;
    let maxGapDays = 0;
    for (let i = 1; i < timestamps.length; i += 1) {
      maxGapDays = Math.max(maxGapDays, (timestamps[i] - timestamps[i - 1]) / 86400);
    }

    const targetRecentGames = Math.max(3, stat.games * 0.35);
    const recentCoverage = Math.min(1, recent90 / targetRecentGames);
    const sixMonthEvidence = Math.min(1, recent180 / Math.max(4, stat.games * 0.55));
    const gapFactor = maxGapDays <= 60 ? 1 : maxGapDays <= 90 ? 0.82 : maxGapDays <= 150 ? 0.62 : maxGapDays <= 240 ? 0.42 : 0.25;
    const recentFactor = recent90 === 0 ? 0.15 : 0.35 + (0.65 * recentCoverage);
    const factor = Math.min(1, recentFactor * (0.65 + (0.35 * sixMonthEvidence)) * gapFactor);
    const summary = `${recent90} jogo(s) nos últimos 90d • maior intervalo: ${Math.round(maxGapDays)}d • consistência: ${Math.round(factor * 100)}%`;

    return { factor, recent90, recent180, maxGapDays, summary };
  }

  function getTeamTemporalScore(stat) {
    const temporal = getTeamTemporalProfile(stat);
    return Math.min(100, Math.round(stat.confidenceScore * temporal.factor * 10) / 10);
  }

  function getTeamBanTier(best, score) {
    if (teamState.scoreMode === 'strict') {
      if (best.tier.level === 'S' && score >= 65 && best.temporal.recent90 >= 3) return { label: 'BAN FORTE', badgeClass: 'ban-tier-s pulse-subtle' };
      if ((best.tier.level === 'S' || best.tier.level === 'A') && score >= 48 && best.temporal.recent90 >= 2) return { label: 'RISCO ALTO', badgeClass: 'ban-tier-a' };
      return { label: 'SECUNDÁRIO', badgeClass: 'ban-tier-c text-slate-400' };
    }
    return { label: best.tier.label, badgeClass: best.tier.badgeClass };
  }

  function setTeamLoading(loading) {
    teamState.loading = loading;
    const button = document.getElementById('team-search-btn');
    document.getElementById('team-search-btn-text').textContent = loading ? 'Consultando equipe...' : 'Analisar equipe';
    button.disabled = loading;
    button.classList.toggle('opacity-75', loading);
  }

  function showTeamError(message) {
    const error = document.getElementById('team-error-message');
    error.textContent = message;
    error.classList.remove('hidden');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }


/**
 * Extrai o ID limpo caso o usuário cole URLs completas da Steam / Dotabuff
 */
function extractAccountId(input) {
  if (!input) return null;
  // Se for apenas dígitos
  if (/^\d+$/.test(input)) return input;
  // Se for URL do Dotabuff: dotabuff.com/players/70388657
  const dotabuffMatch = input.match(/players\/(\d+)/i);
  if (dotabuffMatch) return dotabuffMatch[1];
  // Se for URL do OpenDota: opendota.com/players/70388657
  const opendotaMatch = input.match(/opendota\.com\/players\/(\d+)/i);
  if (opendotaMatch) return opendotaMatch[1];
  return null;
}

async function enrichMatchesWithPositions(matches, accountId) {
  const enriched = [...matches];
  let failedLookups = 0;
  let rateLimited = false;
  let lookups = 0;

  for (let index = 0; index < enriched.length && lookups < MAX_POSITION_DETAIL_LOOKUPS; index += 1) {
    const match = enriched[index];
    if (!match.match_id || getMatchPosition(match)) continue;

    try {
      const position = await fetchMatchPosition(match.match_id, accountId);
      lookups += 1;
      if (position) enriched[index] = { ...match, position };
    } catch (error) {
      if (error.status === 429) {
        rateLimited = true;
        break;
      }
      failedLookups += 1;
    }
  }

  if (failedLookups > 0) {
    console.warn(`${failedLookups} partida(s) não retornaram posição detalhada.`);
  }
  if (rateLimited) {
    console.warn('Limite da API de detalhes atingido; posições disponíveis foram mantidas.');
  }
  return enriched;
}

async function fetchMatchPosition(matchId, accountId) {
  const cacheKey = `${accountId}:${matchId}`;
  if (matchPositionCache.has(cacheKey)) return matchPositionCache.get(cacheKey);

  const response = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
  if (!response.ok) {
    const error = new Error(`OpenDota ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const matchDetails = await response.json();
  const player = Array.isArray(matchDetails.players)
    ? matchDetails.players.find(item => Number(item.account_id) === Number(accountId))
    : null;
  const position = getMatchPosition(player || {});
  matchPositionCache.set(cacheKey, position);
  return position;
}

/**
 * Processa as partidas e calcula os scores de confiança
 */
function processMatchesData() {
  const now = Date.now() / 1000;
  const periodDays = state.selectedMonths * 30.4375;
  const cutoffTimestamp = now - (periodDays * 86400);

  // 1. Filtro temporal (últimos 9 meses por padrão) e filtro de lobby (Ranked vs Ligas DECAN/RDC)
  state.periodMatches = state.rawMatches.filter(m => {
    if (!m.start_time || m.start_time < cutoffTimestamp) return false;

    const isTournament = m.lobby_type === 1 || m.game_mode === 2;
    const isRanked = m.lobby_type === 7;

    if (state.lobbyFilter === 'tournament' && !isTournament) return false;
    if (state.lobbyFilter === 'ranked' && !isRanked) return false;

    return true;
  });

  // Se não houver partidas no período
  if (state.periodMatches.length === 0) {
    state.heroStats = [];
    return;
  }

  // 2. Agrupamento por herói
  const statsMap = {};

  state.periodMatches.forEach(m => {
    const hid = m.hero_id;
    if (!hid) return;

    // Determina vitória
    const isRadiant = m.player_slot < 128;
    const isWin = (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win);

    // Identifica se é Torneio/Liga (DECAN, RDC, CM) ou Ranked
    const isTournament = m.lobby_type === 1 || m.game_mode === 2;
    const isRanked = m.lobby_type === 7;
    const lobbyLabel = isTournament ? '🏆 Liga / Torneio' : (isRanked ? '⚔️ Ranked' : '🎮 Casual');

    // Idade da partida em dias
    const daysAgo = Math.max(0, (now - m.start_time) / 86400);

    // Fator de Recência da partida:
    // Decaimento suave de 1.0 (hoje) até 0.40 (no limite dos 9 meses)
    const recencyWeight = 0.40 + 0.60 * Math.max(0, 1 - (daysAgo / periodDays));

    if (!statsMap[hid]) {
      statsMap[hid] = {
        heroId: hid,
        hero: state.heroes[hid] || { id: hid, localized_name: `Hero #${hid}`, primary_attr: 'unknown', name: '' },
        positions: [],
        games: 0,
        wins: 0,
        losses: 0,
        weightedGames: 0,
        weightedWins: 0,
        lastMatchTime: m.start_time,
        kills: 0,
        deaths: 0,
        assists: 0,
        matches: []
      };
    }

    const s = statsMap[hid];
    const matchPosition = getMatchPosition(m);
    if (matchPosition && !s.positions.includes(matchPosition)) {
      s.positions.push(matchPosition);
      s.positions.sort((a, b) => a - b);
    }
    s.games += 1;
    if (isWin) {
      s.wins += 1;
      s.weightedWins += recencyWeight;
    } else {
      s.losses += 1;
    }
    s.weightedGames += recencyWeight;
    s.kills += m.kills || 0;
    s.deaths += m.deaths || 0;
    s.assists += m.assists || 0;
    s.matches.push({
      matchId: m.match_id,
      startTime: m.start_time,
      isWin,
      isTournament,
      isRanked,
      lobbyLabel,
      kills: m.kills,
      deaths: m.deaths,
      assists: m.assists,
      duration: m.duration,
      daysAgo
    });

    if (m.start_time > s.lastMatchTime) {
      s.lastMatchTime = m.start_time;
    }
  });

  // 3. Cálculo do Score de Confiança Ponderado para cada herói
  const totalPeriodMatches = state.periodMatches.length;

  const results = Object.values(statsMap).map(s => {
    const winrate = (s.wins / s.games) * 100;
    const weightedWinrate = (s.weightedWins / s.weightedGames) * 100;
    
    // Média de recência do herói (0.40 a 1.0)
    const avgRecency = s.weightedGames / s.games;

    // Tempo desde a última partida com este herói (em dias)
    const daysSinceLastMatch = Math.max(0, (now - s.lastMatchTime) / 86400);

    // Indicador visual de Ritmo
    let rhythmStatus;
    if (daysSinceLastMatch <= 25) {
      rhythmStatus = { label: '🔥 Em Ritmo', class: 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60' };
    } else if (daysSinceLastMatch <= 60) {
      rhythmStatus = { label: '⚡ Ativo', class: 'bg-sky-950/60 text-sky-300 border border-sky-800/60' };
    } else if (daysSinceLastMatch <= 120) {
      rhythmStatus = { label: '⚠️ Esfriando', class: 'bg-amber-950/60 text-amber-300 border border-amber-800/60' };
    } else {
      rhythmStatus = { label: '❄️ Inativo', class: 'bg-slate-900 text-slate-400 border border-slate-700' };
    }

    // Fator de amortecimento de volume estatístico:
    // Modelo quadrático rigoroso N^2 / (N^2 + 18):
    // 1 jogo => 0.052 | 2 jogos => 0.181 | 3 jogos => 0.333 | 5 jogos => 0.581 | 10 jogos => 0.847 | 15 jogos => 0.925
    const volumeFactor = (s.games * s.games) / ((s.games * s.games) + 18);

    // Multiplicador de atividade recente:
    const recencyMultiplier = 0.70 + 0.30 * avgRecency;

    // Bônus de representatividade na Hero Pool do jogador (% de jogos que ele dedica a este herói)
    const poolShare = totalPeriodMatches > 0 ? (s.games / totalPeriodMatches) : 0;
    const frequencyMultiplier = 1 + Math.min(0.28, poolShare * 1.4);

    // Pontuação base calibrada
    let rawScore = weightedWinrate * volumeFactor * recencyMultiplier * frequencyMultiplier * 1.15;
    
    // Bônus adicional para comfort pick comprovado (mais de 10 jogos e WR >= 50%)
    if (s.games >= 10 && winrate >= 50) {
      rawScore *= 1.10;
    }

    // Penalidade Severa de Inatividade (quando o Coach opta por priorizar consistência e ritmo recente):
    // Se o herói está parado há 3, 5 ou 8 meses (como Meepo), perde peso drástico no ranking
    if (state.penalizeInactive) {
      let inactivityMultiplier = 1.0;
      if (daysSinceLastMatch <= 21) {
        inactivityMultiplier = 1.0;
      } else if (daysSinceLastMatch <= 45) {
        inactivityMultiplier = 0.90;
      } else if (daysSinceLastMatch <= 90) {
        inactivityMultiplier = 0.65;
      } else if (daysSinceLastMatch <= 150) {
        inactivityMultiplier = 0.35;
      } else if (daysSinceLastMatch <= 210) {
        inactivityMultiplier = 0.18;
      } else {
        // Mais de 7 meses (como 8 meses atrás): frio total!
        inactivityMultiplier = 0.08;
      }
      rawScore *= inactivityMultiplier;
    }

    // Travas rígidas contra distorção de amostras baixas casuais:
    // Se o jogador jogou apenas 1, 2 ou 3 partidas, o score NUNCA atinge nível de perigo
    if (s.games === 1) rawScore = Math.min(rawScore, 12);
    if (s.games === 2) rawScore = Math.min(rawScore, 24);
    if (s.games === 3) rawScore = Math.min(rawScore, 38);

    const confidenceScore = Math.min(100, Math.round(rawScore * 10) / 10);

    // Classificação criteriosa da recomendação de Ban para o Coach:
    let banTier;
    if (s.games < 3) {
      // 1 ou 2 jogos: estritamente Amostra Baixa, sem falso alarme de ban
      banTier = {
        level: 'C',
        label: 'AMOSTRA BAIXA',
        badgeClass: 'ban-tier-c text-slate-400',
        color: 'text-slate-400',
        action: 'Amostra insuficiente'
      };
    } else if (daysSinceLastMatch > 150 && state.penalizeInactive) {
      // Herói abandonado há meses (como o Meepo de 8 meses atrás)
      banTier = {
        level: 'C',
        label: '❄️ INATIVO',
        badgeClass: 'ban-tier-c text-slate-400',
        color: 'text-slate-400',
        action: 'Parado há meses'
      };
    } else if (s.games >= 6 && winrate >= 55 && confidenceScore >= 52 && (daysSinceLastMatch <= 90 || !state.penalizeInactive)) {
      banTier = {
        level: 'S',
        label: 'BAN URGENTE',
        badgeClass: 'ban-tier-s pulse-subtle',
        color: 'text-red-400 font-bold',
        action: 'Prioridade 1 de Ban'
      };
    } else if (s.games >= 4 && winrate >= 50 && confidenceScore >= 38 && (daysSinceLastMatch <= 120 || !state.penalizeInactive)) {
      banTier = {
        level: 'A',
        label: 'RISCO ALTO',
        badgeClass: 'ban-tier-a',
        color: 'text-orange-400 font-semibold',
        action: 'Considerar no Ban'
      };
    } else if ((s.games >= 3 && confidenceScore >= 25) || s.games >= 5) {
      banTier = {
        level: 'B',
        label: 'ATENÇÃO',
        badgeClass: 'ban-tier-b',
        color: 'text-yellow-400',
        action: 'Possível Comfort Pick'
      };
    } else {
      banTier = {
        level: 'C',
        label: 'SECUNDÁRIO',
        badgeClass: 'ban-tier-c',
        color: 'text-slate-400',
        action: 'Baixo Risco'
      };
    }

    // KDA médio
    const kda = s.deaths === 0 ? (s.kills + s.assists).toFixed(1) : ((s.kills + s.assists) / s.deaths).toFixed(1);

    return {
      ...s,
      daysSinceLastMatch,
      rhythmStatus,
      winrate,
      weightedWinrate,
      avgRecency,
      confidenceScore,
      banTier,
      kda
    };
  });

  state.heroStats = results;
}

function getMatchPosition(match) {
  const directPosition = Number(match.lane_role || match.position || match.role);
  if (Number.isInteger(directPosition) && directPosition >= 1 && directPosition <= 5) {
    return directPosition;
  }

  const lane = Number(match.lane);
  if (lane === 1 || lane === 2 || lane === 3) return lane;
  return null;
}

/**
 * Renderiza todos os componentes do dashboard
 */
function renderAll() {
  renderPlayerProfile();
  renderSummaryCards();
  renderTable();
}

/**
 * Renderiza o perfil do adversário
 */
function renderPlayerProfile() {
  const p = state.profile?.profile || {};
  const rankTier = state.profile?.rank_tier;
  const leaderboardRank = state.profile?.leaderboard_rank;
  const mmrEstimate = state.profile?.mmr_estimate?.estimate;

  document.getElementById('profile-name').textContent = p.personaname || p.name || 'Jogador Anônimo';
  document.getElementById('profile-steamid').textContent = `ID: ${state.accountId}`;
  
  const avatarEl = document.getElementById('profile-avatar');
  avatarEl.src = p.avatarfull || p.avatarmedium || 'https://via.placeholder.com/100/1e293b/94a3b8?text=Dota';
  avatarEl.onerror = () => { avatarEl.src = 'https://via.placeholder.com/100/1e293b/94a3b8?text=Dota'; };

  // Rank / Medalha
  const rankEl = document.getElementById('profile-rank');
  if (rankTier) {
    const tierNum = Math.floor(rankTier / 10);
    const starNum = rankTier % 10;
    const tierName = RANK_NAMES[tierNum] || 'Desconhecido';
    
    if (tierNum === 8 && leaderboardRank) {
      rankEl.innerHTML = `<span class="text-amber-400 font-bold">🏆 Imortal #${leaderboardRank}</span>`;
    } else if (tierNum === 8) {
      rankEl.innerHTML = `<span class="text-amber-400 font-bold">🏆 Imortal</span>`;
    } else {
      rankEl.innerHTML = `<span class="text-blue-300 font-medium">${tierName} ★${starNum}</span>`;
    }
  } else if (mmrEstimate) {
    rankEl.innerHTML = `<span class="text-slate-300">MMR Estimado: ~${mmrEstimate}</span>`;
  } else {
    rankEl.innerHTML = `<span class="text-slate-400 text-xs">Rank não calibrado/privado</span>`;
  }

  // Links externos
  document.getElementById('link-dotabuff').href = `https://www.dotabuff.com/players/${state.accountId}`;
  document.getElementById('link-opendota').href = `https://www.opendota.com/players/${state.accountId}`;
  document.getElementById('link-stratz').href = `https://stratz.com/players/${state.accountId}`;
  if (p.profileurl) {
    document.getElementById('link-steam').href = p.profileurl;
    document.getElementById('link-steam').classList.remove('hidden');
  } else {
    document.getElementById('link-steam').classList.add('hidden');
  }
}

/**
 * Renderiza os 4 cards de resumo rápido do Coach
 */
function renderSummaryCards() {
  const totalPeriodMatches = state.periodMatches.length;
  const totalRawMatches = state.rawMatches.length;

  if (totalPeriodMatches === 0) {
    document.getElementById('summary-bans-list').innerHTML = '<p class="text-xs text-amber-400/80">Nenhuma partida nos últimos 9 meses.</p>';
    document.getElementById('top-spammed-hero').textContent = 'Nenhum';
    document.getElementById('top-winrate-hero').textContent = 'Nenhum';
    document.getElementById('period-overview-stats').textContent = '0 partidas';
    return;
  }

  // 1. Top 3 Sugestões de Ban (ordenadas por Score de Confiança decrescente)
  // Requer volume mínimo comprovado (pelo menos 4 partidas) para evitar falsos positivos de 1 ou 2 jogos
  const minGamesForBan = Math.min(4, Math.max(2, Math.floor(totalPeriodMatches * 0.04)));
  let poolForBans = state.heroStats.filter(h => h.games >= minGamesForBan);

  // Se a opção de priorizar ritmo estiver ativa, heróis sem partidas recentes (parados há > 4 meses) não entram nas recomendações de Ban
  if (state.penalizeInactive) {
    poolForBans = poolForBans.filter(h => h.daysSinceLastMatch <= 120);
  }

  // Se o Coach estiver filtrando por posição (ex: Pos 3), exibe as recomendações daquela posição!
  if (state.posFilter !== 'all') {
    const pNum = parseInt(state.posFilter, 10);
    poolForBans = poolForBans.filter(h => h.positions && h.positions.includes(pNum));
  }

  poolForBans.sort((a, b) => b.confidenceScore - a.confidenceScore || b.games - a.games);
  const topBans = poolForBans.slice(0, 3);

  const bansContainer = document.getElementById('summary-bans-list');
  bansContainer.innerHTML = '';

  if (topBans.length === 0) {
    bansContainer.innerHTML = `
      <div class="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
        Nenhum herói com volume suficiente (mín. ${minGamesForBan} jogos) para recomendação de Ban nesta categoria.
      </div>
    `;
  } else {
    topBans.forEach((h, idx) => {
      const heroName = h.hero.localized_name || `Herói #${h.heroId}`;
      const heroImg = getHeroImageUrl(h.hero.name);
      const posBadges = getPositionsBadgeHtml(h.positions);
      const item = document.createElement('div');
      item.className = 'p-2.5 rounded-lg bg-red-950/25 border border-red-900/35 hover:border-red-700/50 transition';
      item.innerHTML = `
        <div class="flex items-center justify-between gap-2.5">
          <!-- Lado Esquerdo: Posição + Imagem Widescreen 16:9 + Nome/WR/Roles -->
          <div class="flex items-center space-x-2.5 min-w-0">
            <span class="w-5 h-5 shrink-0 flex items-center justify-center rounded-full text-xs font-bold ${idx === 0 ? 'bg-red-600 text-white' : 'bg-red-900/70 text-red-200'}">
              ${idx + 1}
            </span>
            <img src="${heroImg}" alt="${heroName}" class="w-13 h-7.5 sm:w-14 sm:h-8 shrink-0 rounded aspect-video object-cover border border-slate-700/80 shadow-sm" onerror="this.src='https://via.placeholder.com/56/1e293b/ffffff?text=Dota'">
            <div class="min-w-0">
              <div class="font-bold text-sm text-slate-100 truncate leading-snug flex items-center space-x-1.5">
                <span>${heroName}</span>
                <span class="flex items-center space-x-1">${posBadges}</span>
              </div>
              <div class="text-[11px] text-slate-400 whitespace-nowrap">
                ${h.games} jogos • <span class="${h.winrate >= 50 ? 'text-emerald-400' : 'text-rose-400'} font-semibold">${h.winrate.toFixed(0)}% WR</span>
              </div>
            </div>
          </div>

          <!-- Lado Direito: Score + Badge sem quebras -->
          <div class="text-right shrink-0 flex flex-col items-end justify-center">
            <div class="text-sm font-bold text-red-400 font-dota tracking-wide whitespace-nowrap leading-tight">${h.confidenceScore} pts</div>
            <span class="mt-0.5 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded uppercase whitespace-nowrap inline-block ${h.banTier.badgeClass}">
              ${h.banTier.label}
            </span>
          </div>
        </div>
      `;
      bansContainer.appendChild(item);
    });
  }

  // 2. Herói Mais Spammado (por número absoluto de partidas)
  const sortedByGames = [...state.heroStats].sort((a, b) => b.games - a.games);
  const mostSpammed = sortedByGames[0];
  if (mostSpammed) {
    const spammedName = mostSpammed.hero.localized_name || `Herói #${mostSpammed.heroId}`;
    const spammedImg = getHeroImageUrl(mostSpammed.hero.name);
    const percentPool = ((mostSpammed.games / totalPeriodMatches) * 100).toFixed(0);
    
    document.getElementById('top-spammed-hero').innerHTML = `
      <div class="flex items-center space-x-3">
        <img src="${spammedImg}" alt="${spammedName}" class="w-14 h-8 shrink-0 rounded aspect-video object-cover border border-slate-700 shadow-sm" onerror="this.src='https://via.placeholder.com/56/1e293b/ffffff?text=Dota'">
        <div class="min-w-0">
          <div class="font-bold text-slate-100 text-sm leading-tight truncate">${spammedName}</div>
          <div class="text-xs text-amber-400 font-semibold mt-0.5 whitespace-nowrap">${mostSpammed.games} partidas (${percentPool}% pool)</div>
          <div class="text-[11px] text-slate-400 whitespace-nowrap">
            ${mostSpammed.wins}V - ${mostSpammed.losses}D • <span class="${mostSpammed.winrate >= 50 ? 'text-emerald-400' : 'text-rose-400'} font-semibold">${mostSpammed.winrate.toFixed(0)}% WR</span>
          </div>
        </div>
      </div>
    `;
  }

  // 3. Maior Winrate com volume relevante (pelo menos 3 jogos)
  const eligibleForWr = state.heroStats.filter(h => h.games >= 3);
  eligibleForWr.sort((a, b) => b.winrate - a.winrate || b.games - a.games);
  const highestWr = eligibleForWr[0] || sortedByGames[0];

  if (highestWr) {
    const wrName = highestWr.hero.localized_name || `Herói #${highestWr.heroId}`;
    const wrImg = getHeroImageUrl(highestWr.hero.name);
    
    document.getElementById('top-winrate-hero').innerHTML = `
      <div class="flex items-center space-x-3">
        <img src="${wrImg}" alt="${wrName}" class="w-14 h-8 shrink-0 rounded aspect-video object-cover border border-slate-700 shadow-sm" onerror="this.src='https://via.placeholder.com/56/1e293b/ffffff?text=Dota'">
        <div class="min-w-0">
          <div class="font-bold text-slate-100 text-sm leading-tight truncate">${wrName}</div>
          <div class="text-xs text-emerald-400 font-bold mt-0.5 whitespace-nowrap">${highestWr.winrate.toFixed(1)}% de Winrate</div>
          <div class="text-[11px] text-slate-400 whitespace-nowrap">${highestWr.games} jogos (${highestWr.wins}V - ${highestWr.losses}D)</div>
        </div>
      </div>
    `;
  }

  // 4. Panorama Geral do Período
  const totalWins = state.periodMatches.filter(m => {
    const isRadiant = m.player_slot < 128;
    return (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win);
  }).length;
  const overallWr = ((totalWins / totalPeriodMatches) * 100).toFixed(1);
  const uniqueHeroes = state.heroStats.length;

  // Contagem de tipos de lobby (Ligas DECAN/RDC/CM vs Ranked)
  const tournamentMatches = state.periodMatches.filter(m => m.lobby_type === 1 || m.game_mode === 2).length;
  const rankedMatches = state.periodMatches.filter(m => m.lobby_type === 7).length;

  document.getElementById('period-overview-stats').innerHTML = `
    <div class="grid grid-cols-2 gap-2 text-center">
      <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
        <div class="text-lg font-bold text-slate-100">${totalPeriodMatches}</div>
        <div class="text-[11px] text-slate-400">Partidas nos ${state.selectedMonths}M</div>
      </div>
      <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
        <div class="text-lg font-bold ${overallWr >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${overallWr}%</div>
        <div class="text-[11px] text-slate-400">Winrate Geral</div>
      </div>
      <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
        <div class="text-lg font-bold text-amber-400">${tournamentMatches}</div>
        <div class="text-[11px] text-slate-400">🏆 Ligas / Torneios</div>
      </div>
      <div class="bg-slate-900/60 p-2 rounded border border-slate-800">
        <div class="text-lg font-bold text-sky-400">${rankedMatches}</div>
        <div class="text-[11px] text-slate-400">⚔️ Ranked Matchmaking</div>
      </div>
    </div>
  `;
}

/**
 * Retorna os heróis com os filtros visuais e ordenação aplicados
 */
function getFilteredAndSortedHeroes() {
  if (!state.heroStats || state.heroStats.length === 0) {
    return [];
  }

  // Filtra dados
  let filtered = state.heroStats.filter(item => {
    // Busca por texto
    if (state.searchQuery) {
      const name = (item.hero.localized_name || '').toLowerCase();
      if (!name.includes(state.searchQuery)) return false;
    }

    // Filtro por Atributo
    if (state.attrFilter !== 'all') {
      const attr = item.hero.primary_attr || '';
      if (attr !== state.attrFilter) return false;
    }

    // Filtro por Posição (1 a 5)
    if (state.posFilter !== 'all') {
      const pNum = parseInt(state.posFilter, 10);
      if (!item.positions || !item.positions.includes(pNum)) return false;
    }

    // Filtro por Mínimo de Partidas
    if (item.games < state.minGamesFilter) {
      return false;
    }

    return true;
  });

  // Ordenação
  filtered.sort((a, b) => {
    let valA = a[state.sortBy];
    let valB = b[state.sortBy];

    if (state.sortBy === 'name') {
      valA = a.hero.localized_name || '';
      valB = b.hero.localized_name || '';
      return state.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }

    if (state.sortBy === 'recency') {
      valA = a.lastMatchTime;
      valB = b.lastMatchTime;
    } else if (state.sortBy === 'score') {
      valA = a.confidenceScore;
      valB = b.confidenceScore;
    }

    return state.sortAsc ? valA - valB : valB - valA;
  });

  return filtered;
}

/**
 * Renderiza a Tabela Principal com os dados e filtros
 */
function renderTable() {
  const tbody = document.getElementById('heroes-table-body');
  tbody.innerHTML = '';

  const filtered = getFilteredAndSortedHeroes();

  document.getElementById('table-count-badge').textContent = `${filtered.length} heróis encontrados`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-8 text-slate-400 text-sm">
          Nenhum herói encontrado com os filtros selecionados.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((h, index) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-800/80 hover:bg-slate-800/40 transition-colors text-sm';

    const heroName = h.hero.localized_name || `Hero #${h.heroId}`;
    const heroImg = getHeroImageUrl(h.hero.name);
    const attrBadge = getAttrBadgeHtml(h.hero.primary_attr);
    const posBadges = getPositionsBadgeHtml(h.positions);
    const lastPlayedText = formatRelativeTime(h.lastMatchTime);
    
    // Cor da barra de winrate
    let wrBarColor = 'bg-rose-500';
    if (h.winrate >= 55) wrBarColor = 'bg-emerald-500';
    else if (h.winrate >= 48) wrBarColor = 'bg-amber-500';

    tr.innerHTML = `
      <!-- Posição no Ranking -->
      <td class="py-3 px-3 text-center font-bold font-dota text-slate-400 whitespace-nowrap">
        #${index + 1}
      </td>

      <!-- Herói, Atributo & Posições -->
      <td class="py-3 px-3">
        <div class="flex items-center space-x-3">
          <img src="${heroImg}" alt="${heroName}" class="w-14 h-8 shrink-0 rounded aspect-video object-cover border border-slate-700/80 shadow-sm" onerror="this.src='https://via.placeholder.com/56/1e293b/ffffff?text=Dota'">
          <div class="min-w-0">
            <div class="font-semibold text-slate-100 flex items-center space-x-1.5 whitespace-nowrap">
              <span>${heroName}</span>
              ${attrBadge}
              <span class="flex items-center space-x-1">${posBadges}</span>
            </div>
            <div class="text-[11px] text-slate-400 flex items-center space-x-2 mt-0.5 whitespace-nowrap">
              <span>KDA: <strong class="text-slate-300">${h.kda}</strong></span>
              <span>•</span>
              <button onclick="openMatchesModal(${h.heroId})" class="text-sky-400 hover:text-sky-300 underline cursor-pointer text-[11px]">
                ver ${h.games} partidas
              </button>
            </div>
          </div>
        </div>
      </td>

      <!-- Volume de Partidas -->
      <td class="py-3 px-3 text-center font-semibold text-slate-200 whitespace-nowrap">
        <span class="text-base">${h.games}</span>
        <div class="text-[10px] text-slate-500 whitespace-nowrap">
          ${((h.games / state.periodMatches.length) * 100).toFixed(0)}% do pool
        </div>
      </td>

      <!-- Vitórias / Derrotas -->
      <td class="py-3 px-3 text-center text-xs whitespace-nowrap">
        <div class="flex items-center justify-center space-x-1.5">
          <span class="text-emerald-400 font-semibold">${h.wins}V</span>
          <span class="text-slate-600">-</span>
          <span class="text-rose-400 font-semibold">${h.losses}D</span>
        </div>
      </td>

      <!-- Winrate com barra visual -->
      <td class="py-3 px-3 whitespace-nowrap">
        <div class="w-32 mx-auto">
          <div class="flex justify-between items-center text-xs mb-1">
            <span class="font-bold ${h.winrate >= 50 ? 'text-emerald-400' : 'text-rose-400'}">
              ${h.winrate.toFixed(1)}%
            </span>
            <span class="text-[10px] text-slate-400 font-mono">pond: ${h.weightedWinrate.toFixed(0)}%</span>
          </div>
          <div class="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
            <div class="${wrBarColor} h-1.5 rounded-full" style="width: ${Math.min(100, Math.max(5, h.winrate))}%"></div>
          </div>
        </div>
      </td>

      <!-- Recência & Ritmo de Jogo -->
      <td class="py-3 px-3 text-center whitespace-nowrap">
        <div class="flex flex-col items-center space-y-1">
          <div class="text-xs text-slate-200 font-medium">${lastPlayedText}</div>
          <span class="text-[9px] font-bold px-2 py-0.5 rounded ${h.rhythmStatus.class}">
            ${h.rhythmStatus.label}
          </span>
        </div>
      </td>

      <!-- Score de Confiança & Prioridade -->
      <td class="py-3 px-3 text-right whitespace-nowrap">
        <div class="flex flex-col items-end">
          <div class="flex items-center space-x-1.5">
            <span class="text-base font-bold text-white font-dota tracking-wide bg-slate-900 px-2.5 py-0.5 rounded border border-slate-700">
              ${h.confidenceScore}
            </span>
          </div>
          <span class="mt-1 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded uppercase whitespace-nowrap inline-block ${h.banTier.badgeClass}">
            ${h.banTier.label}
          </span>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

/**
 * Atualiza os indicadores de setas na ordenação das colunas
 */
function updateSortIndicators() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const field = th.getAttribute('data-sort');
    const indicator = th.querySelector('.sort-indicator');
    if (indicator) {
      if (state.sortBy === field) {
        indicator.textContent = state.sortAsc ? ' ↑' : ' ↓';
        indicator.className = 'sort-indicator text-red-400 font-bold';
      } else {
        indicator.textContent = ' ↕';
        indicator.className = 'sort-indicator text-slate-600';
      }
    }
  });
}

/**
 * Retorna o HTML da badge de atributo
 */
function getAttrBadgeHtml(attr) {
  if (attr === 'str') return '<span class="badge-str text-[10px] px-1 py-0.2 rounded font-semibold uppercase">STR</span>';
  if (attr === 'agi') return '<span class="badge-agi text-[10px] px-1 py-0.2 rounded font-semibold uppercase">AGI</span>';
  if (attr === 'int') return '<span class="badge-int text-[10px] px-1 py-0.2 rounded font-semibold uppercase">INT</span>';
  if (attr === 'all') return '<span class="badge-all text-[10px] px-1 py-0.2 rounded font-semibold uppercase">UNI</span>';
  return '';
}

/**
 * Retorna o HTML das badges de posições (Pos 1 a Pos 5)
 */
function getPositionsBadgeHtml(positions) {
  if (!positions || !Array.isArray(positions) || positions.length === 0) {
    return '<span class="text-[10px] text-slate-500">Posição não informada</span>';
  }
  return positions.map(p => {
    return `<span class="badge-pos badge-pos-${p}">Pos ${p}</span>`;
  }).join(' ');
}

function formatPositions(positions) {
  return positions && positions.length > 0 ? `Pos ${positions.join('/')}` : 'Posição não informada';
}

/**
 * Obtém URL da imagem do herói
 */
function getHeroImageUrl(heroInternalName) {
  if (!heroInternalName) return 'https://via.placeholder.com/64/1e293b/ffffff?text=Dota';
  const cleanName = heroInternalName.replace('npc_dota_hero_', '');
  return `${STEAM_HERO_IMG_CDN}${cleanName}.png`;
}

/**
 * Formata timestamp em tempo relativo legível ("há 2 dias", "há 3 meses")
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return 'desconhecido';
  const now = Date.now() / 1000;
  const diffSeconds = Math.max(0, now - timestamp);
  const diffDays = Math.floor(diffSeconds / 86400);

  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `há ${diffDays} dias`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 5) return `há ${weeks} ${weeks === 1 ? 'sem.' : 'sems.'}`;
  const months = Math.floor(diffDays / 30.4375);
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

/**
 * Formata data legível DD/MM/AAAA
 */
function formatDate(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString('pt-BR');
}

/**
 * Formata segundos para MM:SS
 */
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Abre o modal de partidas detalhadas daquele herói
 */
window.openMatchesModal = function(heroId) {
  const stat = state.heroStats.find(h => h.heroId === heroId);
  if (!stat) return;

  const modal = document.getElementById('matches-modal');
  const heroName = stat.hero.localized_name || `Herói #${heroId}`;
  const heroImg = getHeroImageUrl(stat.hero.name);

  document.getElementById('modal-hero-header').innerHTML = `
    <div class="flex items-center space-x-3.5">
      <img src="${heroImg}" alt="${heroName}" class="w-16 h-9 shrink-0 rounded aspect-video object-cover border border-slate-700 shadow-md" onerror="this.src='https://via.placeholder.com/64/1e293b/ffffff?text=Dota'">
      <div>
        <h3 class="text-lg font-bold text-slate-100">${heroName}</h3>
        <p class="text-xs text-slate-400 whitespace-nowrap">
          ${stat.games} partidas nos últimos ${state.selectedMonths} meses • 
          <span class="${stat.winrate >= 50 ? 'text-emerald-400' : 'text-rose-400'} font-semibold">${stat.winrate.toFixed(0)}% de Vitórias</span> • 
          Score de Confiança: <strong class="text-amber-400">${stat.confidenceScore} pts</strong>
        </p>
      </div>
    </div>
  `;

  const listContainer = document.getElementById('modal-matches-list');
  listContainer.innerHTML = '';

  const sortedMatches = [...stat.matches].sort((a, b) => b.startTime - a.startTime);

  sortedMatches.forEach(m => {
    const item = document.createElement('div');
    const modeBadge = m.isTournament
      ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60 whitespace-nowrap">🏆 Liga / Torneio (CM)</span>'
      : (m.isRanked ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 whitespace-nowrap">⚔️ Ranked</span>' : '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 whitespace-nowrap">🎮 Normal</span>');

    item.className = `p-2.5 rounded border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
      m.isWin 
        ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-200' 
        : 'bg-rose-950/20 border-rose-900/40 text-rose-200'
    }`;

    item.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <span class="px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
          m.isWin ? 'bg-emerald-800 text-emerald-100' : 'bg-rose-800 text-rose-100'
        }">
          ${m.isWin ? 'Vitória' : 'Derrota'}
        </span>
        ${modeBadge}
        <span class="text-slate-300 font-medium">KDA: <strong>${m.kills}/${m.deaths}/${m.assists}</strong></span>
        <span class="text-slate-500">•</span>
        <span class="text-slate-400">Duração: ${formatDuration(m.duration)}</span>
      </div>
      <div class="flex items-center space-x-2 text-right">
        <span class="text-slate-400 text-[11px]">${formatDate(m.startTime)} (${formatRelativeTime(m.startTime)})</span>
        <a href="https://www.opendota.com/matches/${m.matchId}" target="_blank" class="text-sky-400 hover:text-sky-300 text-[11px] underline">
          #${m.matchId}
        </a>
      </div>
    `;

    listContainer.appendChild(item);
  });

  modal.classList.remove('hidden');
};

/**
 * Gera e copia relatório formatado para Discord / WhatsApp
 */
function copyDiscordReport() {
  if (state.heroStats.length === 0) {
    alert('Nenhum dado para exportar.');
    return;
  }

  const p = state.profile?.profile || {};
  const playerName = p.personaname || p.name || `Player ${state.accountId}`;
  const totalMatches = state.periodMatches.length;

  const sortedByScore = [...state.heroStats].sort((a, b) => b.confidenceScore - a.confidenceScore);
  const topBans = sortedByScore.slice(0, 5);

  let text = `🎯 **RELATÓRIO DE SCOUTING DOTA 2 - ADVERSÁRIO**\n`;
  text += `👤 **Jogador:** ${playerName} (Friend ID: \`${state.accountId}\`)\n`;
  text += `📅 **Período:** Últimos ${state.selectedMonths} meses (${totalMatches} partidas analisadas)\n`;
  text += `🔗 Dotabuff: <https://www.dotabuff.com/players/${state.accountId}>\n\n`;

  text += `🚫 **RECOMENDAÇÃO DE BANS (Score de Confiança):**\n`;
  topBans.forEach((h, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🔹';
    const posStr = h.positions ? `[Pos ${h.positions.join('/')}]` : '';
    text += `${medal} **${h.hero.localized_name}** ${posStr}: ${h.games} jogos | ${h.winrate.toFixed(0)}% WR | Score: **${h.confidenceScore}** (${h.banTier.label})\n`;
  });

  const sortedByGames = [...state.heroStats].sort((a, b) => b.games - a.games);
  const mostSpammed = sortedByGames[0];
  if (mostSpammed) {
    const spammedPos = mostSpammed.positions ? `[Pos ${mostSpammed.positions.join('/')}]` : '';
    text += `\n🎯 **Herói mais spammado:** ${mostSpammed.hero.localized_name} ${spammedPos} (${mostSpammed.games} partidas, ${mostSpammed.winrate.toFixed(0)}% WR)\n`;
  }

  text += `\n*Gerado pelo Analisador de Inimigos Dota 2.*`;

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-discord-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '✅ Copiado com Sucesso!';
    btn.classList.add('bg-emerald-700');
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove('bg-emerald-700');
    }, 2500);
  }).catch(err => {
    console.error('Erro ao copiar:', err);
    alert('Não foi possível copiar automaticamente. Use a exportação CSV.');
  });
}

/**
 * Exporta a tabela atual em formato CSV para Excel
 */
function exportCSV() {
  if (state.heroStats.length === 0) {
    alert('Nenhum dado para exportar.');
    return;
  }

  const filtered = getFilteredAndSortedHeroes();
  if (filtered.length === 0) {
    alert('Nenhum herói encontrado com os filtros atuais para exportar.');
    return;
  }

  const p = state.profile?.profile || {};
  const playerName = p.personaname || state.accountId;

  const monthsLabel = state.selectedMonths ? `Partidas_${state.selectedMonths}_Meses` : 'Partidas_Periodo';
  let csv = `Posicao_Ranking;Heroi;Posicoes_Dota;Atributo;${monthsLabel};Vitorias;Derrotas;Winrate_Percent;Fator_Recencia_Medio;Score_Confianca;Recomendacao_Ban\n`;

  filtered.forEach((h, i) => {
    const posStr = h.positions ? `Pos ${h.positions.join('/')}` : '';
    const row = [
      i + 1,
      `"${h.hero.localized_name || h.heroId}"`,
      `"${posStr}"`,
      h.hero.primary_attr || '',
      h.games,
      h.wins,
      h.losses,
      h.winrate.toFixed(1),
      h.avgRecency.toFixed(2),
      h.confidenceScore,
      `"${h.banTier.label}"`
    ].join(';');
    csv += row + '\n';
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `dota2_scout_${playerName}_${state.accountId}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Controladores visuais de estado (Loading, Erros, Telas)
 */
function setLoading(loading) {
  state.isLoading = loading;
  const spinner = document.getElementById('loading-spinner');
  const btnText = document.getElementById('search-btn-text');
  const btn = document.getElementById('search-btn');

  if (loading) {
    spinner.classList.remove('hidden');
    btnText.textContent = 'Consultando OpenDota...';
    btn.disabled = true;
    btn.classList.add('opacity-75', 'cursor-not-allowed');
  } else {
    spinner.classList.add('hidden');
    btnText.textContent = 'Consultar Jogador';
    btn.disabled = false;
    btn.classList.remove('opacity-75', 'cursor-not-allowed');
  }
}

function showError(msg) {
  const errBox = document.getElementById('error-message');
  errBox.textContent = msg;
  errBox.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-message').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('dashboard-content').classList.remove('hidden');
  document.getElementById('empty-state').classList.add('hidden');
}

function hideDashboard() {
  document.getElementById('dashboard-content').classList.add('hidden');
  document.getElementById('empty-state').classList.remove('hidden');
}
