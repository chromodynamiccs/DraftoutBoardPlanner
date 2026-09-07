// Pure draft logic. No DOM access here — everything is a function of a
// single state object, so Phase 2 can swap where the state lives without
// touching this file.
(function () {
  const ARMOR_PIECES = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];

  function formatColorName(color) {
    return color
      .split('_')
      .map(w => w[0].toUpperCase() + w.slice(1))
      .join(' ');
  }

  // Builds the pool of pickable *categories* — one entry per base goal, so
  // every one of the 289 base goals has equal probability of being offered.
  // A plain goal is a 'simple' category (single-use). A goal that needs
  // data is a 'colored' (or 'coloredPiece', for the one goal with two
  // placeholders) category that carries its own list of not-yet-used
  // color(+piece) variants — it keeps being offerable, at the same
  // one-goal weight as anything else, until that list runs out. The
  // specific color is only chosen when the category is actually offered
  // (see materializeEntry), never baked into the pool up front.
  function buildPool(baseGoals, colors) {
    const pool = [];
    for (const g of baseGoals) {
      if (!g.needsData) {
        pool.push({ kind: 'simple', key: g.id, id: g.id, name: g.name });
        continue;
      }
      if (g.id === 'WEAR_COLORED_LEATHER_ARMOR_PIECE') {
        const remaining = [];
        for (const color of colors) {
          for (const piece of ARMOR_PIECES) remaining.push({ color, piece });
        }
        pool.push({ kind: 'coloredPiece', key: g.id, id: g.id, nameTemplate: g.name, remaining });
      } else {
        pool.push({ kind: 'colored', key: g.id, id: g.id, nameTemplate: g.name, remaining: colors.slice() });
      }
    }
    return pool;
  }

  // Turns a pool category into an actual offerable goal: for 'colored'/
  // 'coloredPiece' categories this is where the random color (and armor
  // piece) gets picked, from whatever's still left for that category.
  function materializeEntry(entry) {
    if (entry.kind === 'simple') {
      return { key: entry.key, id: entry.id, name: entry.name, data: 'null', categoryKey: entry.key };
    }
    if (entry.kind === 'colored') {
      const color = entry.remaining[Math.floor(Math.random() * entry.remaining.length)];
      const name = entry.nameTemplate.replace('%1$s', formatColorName(color));
      return { key: `${entry.id}|${color}`, id: entry.id, name, data: color, categoryKey: entry.key, variantColor: color };
    }
    // coloredPiece
    const variant = entry.remaining[Math.floor(Math.random() * entry.remaining.length)];
    const name = entry.nameTemplate
      .replace('%1$s', formatColorName(variant.color))
      .replace('%2$s', variant.piece);
    return {
      key: `${entry.id}|${variant.color}|${variant.piece}`,
      id: entry.id,
      name,
      data: variant.color,
      categoryKey: entry.key,
      variantColor: variant.color,
      variantPiece: variant.piece,
    };
  }

  // Removes the specific variant an offered goal used from its category
  // (once picked or rejected, that exact color/piece is gone for good). A
  // 'simple' category disappears entirely; a colored one disappears once
  // its remaining list is empty.
  function consumeVariant(pool, offered) {
    return pool
      .map(entry => {
        if (entry.key !== offered.categoryKey) return entry;
        if (entry.kind === 'simple') return null;
        const remaining = entry.kind === 'colored'
          ? entry.remaining.filter(c => c !== offered.variantColor)
          : entry.remaining.filter(v => !(v.color === offered.variantColor && v.piece === offered.variantPiece));
        return remaining.length === 0 ? null : { ...entry, remaining };
      })
      .filter(Boolean);
  }

  // Rotating order: players simply cycle A B C A B C ... regardless of
  // player count.
  function buildSnakeOrder(numPlayers, totalPicks) {
    const order = [];
    for (let i = 0; i < totalPicks; i++) order.push(i % numPlayers);
    return order;
  }

  function sampleTwo(pool) {
    if (pool.length < 2) {
      throw new Error('Not enough goals left in the pool to make an offer');
    }
    const i = Math.floor(Math.random() * pool.length);
    let j = Math.floor(Math.random() * (pool.length - 1));
    if (j >= i) j++;
    return [pool[i], pool[j]];
  }

  // Snapshot of state without `history`, used to push/pop undo frames.
  function snapshotForHistory(state) {
    const { history, ...rest } = state;
    return JSON.parse(JSON.stringify(rest));
  }

  function createInitialState(players, boardSize, baseGoals, colors, rerollsPerPlayer) {
    const totalPicks = boardSize * boardSize;
    const perPlayer = Number.isFinite(rerollsPerPlayer) ? Math.max(0, rerollsPerPlayer) : 1;
    const state = {
      players,
      boardSize,
      totalPicks,
      order: buildSnakeOrder(players.length, totalPicks),
      pickIndex: 0,
      pool: buildPool(baseGoals, colors),
      board: [],
      currentOffer: null,
      complete: false,
      history: [],
      rerollsRemaining: players.map(() => perPlayer),
    };
    return offerGoals(state);
  }

  // Draws a fresh offer of 2 categories from the pool and materializes each
  // into an actual goal (choosing a color for 'colored' categories). Does
  // not mutate pool — nothing is consumed until pickGoal commits it.
  function offerGoals(state) {
    if (state.complete) return { ...state, currentOffer: null };
    const [catA, catB] = sampleTwo(state.pool);
    return { ...state, currentOffer: [materializeEntry(catA), materializeEntry(catB)] };
  }

  // True if the player whose turn it currently is still has a reroll left.
  function canReroll(state) {
    if (!state.currentOffer) return false;
    const playerIndex = state.order[state.pickIndex];
    return state.rerollsRemaining[playerIndex] > 0;
  }

  // Spends one of the current player's rerolls: draws a fresh pair of
  // offered goals. The previously offered goals are still in the pool (only
  // `pickGoal` ever removes goals from it), so this is just a fresh draw.
  // No-op if the player has none left.
  function rerollOffer(state) {
    if (!canReroll(state)) return state;
    const playerIndex = state.order[state.pickIndex];
    const snapshot = snapshotForHistory(state);
    const rerollsRemaining = state.rerollsRemaining.slice();
    rerollsRemaining[playerIndex] -= 1;
    const next = { ...state, rerollsRemaining, history: [...state.history, snapshot] };
    return offerGoals(next);
  }

  // Applies a pick: appends the chosen goal to the board for the current
  // player, discards both offered goals from the pool, and offers the next
  // pair (or marks the draft complete).
  function pickGoal(state, chosenKey) {
    if (!state.currentOffer) return state;
    const [a, b] = state.currentOffer;
    const chosen = a.key === chosenKey ? a : b.key === chosenKey ? b : null;
    if (!chosen) return state;

    const playerIndex = state.order[state.pickIndex];
    const placed = { ...chosen, playerIndex };
    // Both the picked and the rejected variant are gone for good (rejected
    // goals are discarded, not returned to the pool).
    const nextPool = consumeVariant(consumeVariant(state.pool, a), b);
    const nextPickIndex = state.pickIndex + 1;
    const complete = nextPickIndex >= state.totalPicks;

    const snapshot = snapshotForHistory(state);
    const next = {
      ...state,
      pool: nextPool,
      board: [...state.board, placed],
      pickIndex: nextPickIndex,
      complete,
      currentOffer: null,
      history: [...state.history, snapshot],
    };
    return complete ? next : offerGoals(next);
  }

  function undoPick(state) {
    if (!state.history || state.history.length === 0) return state;
    const prev = state.history[state.history.length - 1];
    return { ...prev, history: state.history.slice(0, -1) };
  }

  function exportBoardJSON(state) {
    return {
      size: state.boardSize,
      goals: state.board.map(g => ({ id: g.id, data: g.data })),
    };
  }

  function exportBoardText(state) {
    const lines = state.board.map((g, i) => {
      const row = Math.floor(i / state.boardSize) + 1;
      const col = (i % state.boardSize) + 1;
      const player = state.players[g.playerIndex];
      const dataSuffix = g.data !== 'null' ? ` (${g.data})` : '';
      return `${row}x${col}\t${g.name}${dataSuffix}\t— picked by ${player}`;
    });
    return lines.join('\n');
  }

  window.DraftLogic = {
    buildPool,
    buildSnakeOrder,
    createInitialState,
    offerGoals,
    pickGoal,
    undoPick,
    canReroll,
    rerollOffer,
    exportBoardJSON,
    exportBoardText,
    formatColorName,
  };
})();
