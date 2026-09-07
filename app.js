(function () {
  const STORAGE_KEY = 'draftout-3p-state-v1';
  const { DraftLogic } = window;
  const { BASE_GOALS, DYE_COLORS } = window;

  let state = null;

  // ---------- persistence ----------
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // storage full/unavailable — draft still works, just won't resume
      console.warn('Could not save draft to localStorage', e);
    }
  }

  function loadSavedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSavedState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- screens ----------
  const screens = {
    setup: document.getElementById('screen-setup'),
    draft: document.getElementById('screen-draft'),
    end: document.getElementById('screen-end'),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle('active', key === name);
    });
  }

  // ---------- setup screen ----------
  const form = document.getElementById('setup-form');
  const resumeBanner = document.getElementById('resume-banner');
  const resumeBtn = document.getElementById('resume-btn');
  const discardResumeBtn = document.getElementById('discard-resume-btn');
  const p4Field = document.getElementById('p4-field');
  const toggleP4Btn = document.getElementById('toggle-p4-btn');

  toggleP4Btn.addEventListener('click', () => {
    p4Field.hidden = !p4Field.hidden;
    toggleP4Btn.textContent = p4Field.hidden ? '+ Add 4th player' : '− Remove 4th player';
    if (p4Field.hidden) document.getElementById('p4').value = '';
  });

  function initSetupScreen() {
    const saved = loadSavedState();
    if (saved && !saved.complete) {
      resumeBanner.hidden = false;
      resumeBtn.onclick = () => {
        state = saved;
        showScreen('draft');
        renderDraft();
      };
      discardResumeBtn.onclick = () => {
        clearSavedState();
        resumeBanner.hidden = true;
      };
    } else {
      resumeBanner.hidden = true;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const players = [
      (data.get('p1') || '').trim() || 'P1',
      (data.get('p2') || '').trim() || 'P2',
      (data.get('p3') || '').trim() || 'P3',
    ];
    if (!p4Field.hidden) {
      players.push((data.get('p4') || '').trim() || 'P4');
    }
    let boardSize = parseInt(data.get('boardSize'), 10);
    if (!Number.isFinite(boardSize)) boardSize = 6;
    boardSize = Math.min(7, Math.max(3, boardSize));

    let rerolls = parseInt(data.get('rerolls'), 10);
    if (!Number.isFinite(rerolls)) rerolls = 1;
    rerolls = Math.min(10, Math.max(0, rerolls));

    state = DraftLogic.createInitialState(players, boardSize, BASE_GOALS, DYE_COLORS, rerolls);
    saveState();
    showScreen('draft');
    renderDraft();
  });

  // ---------- draft screen ----------
  const turnLabel = document.getElementById('turn-label');
  const turnDot = document.getElementById('turn-dot');
  const picksRemainingEl = document.getElementById('picks-remaining');
  const offerGrid = document.getElementById('offer-grid');
  const boardGrid = document.getElementById('board-grid');
  const undoBtn = document.getElementById('undo-btn');
  const rerollBtn = document.getElementById('reroll-btn');
  const pickTimerEl = document.getElementById('pick-timer');
  const legend = document.getElementById('legend');

  // ---------- pick timer ----------
  // 10s auto-pick, matching real Draftout. Timing is ephemeral UI state —
  // it lives here, not in the pure DraftLogic state object.
  const PICK_SECONDS = 10;
  let timerInterval = null;
  let timeLeft = 0;

  function clearPickTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerDisplay() {
    pickTimerEl.textContent = `${timeLeft}s`;
    pickTimerEl.classList.toggle('urgent', timeLeft <= 3);
  }

  function startPickTimer() {
    clearPickTimer();
    if (!state || !state.currentOffer || state.complete) {
      pickTimerEl.textContent = '';
      return;
    }
    timeLeft = PICK_SECONDS;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft <= 0) {
        clearPickTimer();
        autoPick();
        return;
      }
      updateTimerDisplay();
    }, 1000);
  }

  function autoPick() {
    if (!state || !state.currentOffer) return;
    const options = state.currentOffer;
    const choice = options[Math.floor(Math.random() * options.length)];
    onPick(choice.key);
  }

  function playerColorClass(idx) {
    return `player-P${idx}`;
  }

  function goalLabel(goal) {
    return goal.name;
  }

  function renderLegend() {
    legend.innerHTML = state.players
      .map((name, i) => `
        <span class="legend-item">
          <span class="legend-swatch swatch-${i}"></span>${escapeHtml(name)}
        </span>
      `)
      .join('');
  }

  function renderTurnBanner() {
    const playerIdx = state.order[state.pickIndex];
    turnLabel.textContent = `${state.players[playerIdx]}'s turn`;
    turnDot.className = `turn-dot swatch-${playerIdx}`;
    picksRemainingEl.textContent = `${state.board.length} / ${state.totalPicks} picks made`;
  }

  function renderOffer() {
    offerGrid.innerHTML = '';
    if (!state.currentOffer) return;
    state.currentOffer.forEach((goal) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'offer-card';
      card.innerHTML = `${escapeHtml(goalLabel(goal))}`;
      card.addEventListener('click', () => onPick(goal.key));
      offerGrid.appendChild(card);
    });
  }

  // Shrinks a tile's text until it fits without clipping, since goal names
  // vary too much in length for a fixed clamp() to always fit a square tile.
  function shrinkToFit(tile, nameEl) {
    let size = parseFloat(getComputedStyle(nameEl).fontSize);
    const minSize = 8;
    while (size > minSize && (nameEl.scrollHeight > tile.clientHeight || nameEl.scrollWidth > tile.clientWidth)) {
      size -= 1;
      nameEl.style.fontSize = `${size}px`;
    }
  }

  function renderBoard(targetEl) {
    targetEl.innerHTML = '';
    targetEl.style.gridTemplateColumns = `repeat(${state.boardSize}, 1fr)`;
    const total = state.totalPicks;
    const filledTiles = [];
    for (let i = 0; i < total; i++) {
      const tile = document.createElement('div');
      const placed = state.board[i];
      if (placed) {
        tile.className = `tile ${playerColorClass(placed.playerIndex)}`;
        tile.title = `${placed.name} — ${state.players[placed.playerIndex]}`;
        tile.innerHTML = `<span class="tile-name">${escapeHtml(placed.name)}</span>`;
        filledTiles.push(tile);
      } else {
        tile.className = 'tile empty';
        tile.textContent = '';
      }
      targetEl.appendChild(tile);
    }
    // Font sizing depends on layout, so measure after the tiles are in the DOM.
    for (const tile of filledTiles) {
      shrinkToFit(tile, tile.querySelector('.tile-name'));
    }
  }

  function onPick(key) {
    clearPickTimer();
    state = DraftLogic.pickGoal(state, key);
    saveState();
    if (state.complete) {
      showScreen('end');
      renderEnd();
    } else {
      renderDraft();
    }
  }

  undoBtn.addEventListener('click', () => {
    state = DraftLogic.undoPick(state);
    saveState();
    renderDraft();
  });

  rerollBtn.addEventListener('click', () => {
    state = DraftLogic.rerollOffer(state);
    saveState();
    renderDraft();
  });

  function renderDraft() {
    renderLegend();
    renderTurnBanner();
    renderOffer();
    renderBoard(boardGrid);
    undoBtn.disabled = !state.history || state.history.length === 0;
    const canReroll = DraftLogic.canReroll(state);
    rerollBtn.disabled = !canReroll;
    const playerIdx = state.order[state.pickIndex];
    const rerollsLeft = state.rerollsRemaining[playerIdx];
    rerollBtn.textContent = rerollsLeft > 0 ? `Reroll (${rerollsLeft} left)` : 'Reroll (used)';
    startPickTimer();
  }

  // ---------- end screen ----------
  const endBoardGrid = document.getElementById('end-board-grid');
  const downloadJsonBtn = document.getElementById('download-json-btn');
  const downloadTextBtn = document.getElementById('download-text-btn');
  const exportTextarea = document.getElementById('export-textarea');
  const newDraftBtn = document.getElementById('new-draft-btn');
  const boardNameInput = document.getElementById('board-name');

  function suggestedFileName() {
    const raw = (boardNameInput.value || 'draftout-board').trim();
    const safe = raw.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'draftout-board';
    return safe;
  }

  function renderEnd() {
    renderBoard(endBoardGrid);
    exportTextarea.value = DraftLogic.exportBoardText(state);
    if (!boardNameInput.value) boardNameInput.value = 'draftout-board';
  }

  function downloadBlob(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  downloadJsonBtn.addEventListener('click', () => {
    const json = DraftLogic.exportBoardJSON(state);
    downloadBlob(`${suggestedFileName()}.json`, 'application/json', JSON.stringify(json, null, 2));
  });

  downloadTextBtn.addEventListener('click', () => {
    downloadBlob(`${suggestedFileName()}.txt`, 'text/plain', DraftLogic.exportBoardText(state));
  });

  newDraftBtn.addEventListener('click', () => {
    clearPickTimer();
    clearSavedState();
    state = null;
    form.reset();
    initSetupScreen();
    showScreen('setup');
  });

  // ---------- utils ----------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- init ----------
  initSetupScreen();
  showScreen('setup');
})();
