/* Last Card game engine — classic UNO rules, plus the Wild Rush mode.
   Runs on the server for online tables and in the browser for practice games. */
(function (root) {
  "use strict";
  const COLORS = ["r", "y", "g", "b"];
  const CNAME = { r: "Red", y: "Yellow", g: "Green", b: "Blue" };
  const BOTN = ["Mara", "Juno", "Otis", "Pip", "Rook", "Wren", "Ines", "Taro", "Sol", "Bea", "Kit", "Lumi"];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rand = (a, b) => a + Math.random() * (b - a);
  /* Modes: "classic" is the standard deck. "wild" (Wild Rush) is an all-wild deck: every card plays on
     anything, nobody picks colors, and "wx" (Wild Swap) trades hands with a chosen player. */
  const MODES = ["classic", "wild"];
  const WILD_PTS = { w: 5, s: 5, r: 5, d: 5, f: 10, x: 10 }; // low, because every card is a wild
  const points = (c, mode) => mode === "wild" ? WILD_PTS[c[1]] || 5 : c[0] === "w" ? 50 : "srd".includes(c[1]) ? 20 : +c[1];
  const WILD_NAMES = { w: "Wild", f: "Wild Draw Four", s: "Wild Skip", r: "Wild Reverse", d: "Wild Draw Two", x: "Wild Swap" };
  function cardLabel(c) {
    const v = c[1], col = c[0];
    if (col === "w") return WILD_NAMES[v] || "Wild";
    const vn = v === "s" ? "Skip" : v === "r" ? "Reverse" : v === "d" ? "Draw Two" : v;
    return `${CNAME[col]} ${vn}`;
  }
  function buildDeck(mode) {
    const d = [];
    if (mode === "wild") {
      // 108 cards, like the classic deck. Draw cards are kept rare so stacks don't spiral.
      for (const [v, n] of [["w", 44], ["s", 20], ["r", 20], ["d", 10], ["f", 6], ["x", 8]]) for (let i = 0; i < n; i++) d.push("w" + v);
      return shuffle(d);
    }
    for (const c of COLORS) { d.push(c + "0"); for (let n = 1; n <= 9; n++) d.push(c + n, c + n); for (const a of "srd") d.push(c + a, c + a); }
    for (let i = 0; i < 4; i++) d.push("ww", "wf");
    return shuffle(d);
  }

  function Engine(code, hostId, hostName, opts) {
    opts = opts || {};
    const G = {
      code, phase: "wait", players: [{ p: hostId, n: hostName || "Host", b: false, hand: [], s: 0, u: false }],
      deck: [], disc: [], top: null, col: null, dir: 1, turn: 0, dr: -1, ch: null, uv: -1,
      log: [], evs: [], evk: 0, target: 250, round: 0, dealer: 0, rw: null, hostSeat: 0,
      stack: opts.stack !== false, pen: 0, mode: MODES.includes(opts.mode) ? opts.mode : "classic"
    };
    const wild = () => G.mode === "wild";
    let botTimer = null, catchTimer = null, stopped = false;
    const onChange = opts.onChange || (() => {});
    const delay = opts.botDelay || 850;

    const N = () => G.players.length;
    const idx = i => ((i % N()) + N()) % N();
    const log = t => { G.log.push(t); if (G.log.length > 6) G.log.shift(); };
    const ev = o => { o.k = ++G.evk; G.evs.push(o); if (G.evs.length > 10) G.evs.shift(); };
    /* While a draw penalty is building, only the same draw card can be stacked on it. */
    const canPlay = c => G.pen > 0 ? (G.top === "wf" ? c === "wf" : c[1] === "d")
      : c[0] === "w" || c[0] === G.col || c[1] === G.top[1];
    /* Bots sometimes react with an emote (indexes match the client's emote list). */
    const botEmote = (seat, list, chance) => {
      const p = G.players[seat];
      if (p && p.b && Math.random() < chance) ev({ ty: "emo", w: seat, e: list[Math.floor(Math.random() * list.length)] });
    };
    const advance = k => { G.turn = idx(G.turn + G.dir * k); };
    const clearUv = seat => { if (G.uv >= 0 && G.uv !== seat) G.uv = -1; };

    function refill() {
      if (G.deck.length || G.disc.length <= 1) return;
      const top = G.disc.pop(); G.deck = shuffle(G.disc); G.disc = [top]; log("The discard pile was reshuffled");
    }
    function drawCards(seat, k) {
      const p = G.players[seat]; let got = 0;
      for (let i = 0; i < k; i++) { refill(); if (!G.deck.length) break; p.hand.push(G.deck.pop()); got++; }
      if (p.hand.length > 1) p.u = false;
      if (G.uv === seat) G.uv = -1;
      if (got) ev({ ty: "draw", w: seat, n: got });
      return got;
    }
    function addBot() {
      if (G.players.length >= 8) return false;
      const used = new Set(G.players.map(p => p.n));
      const n = BOTN.find(b => !used.has(b)) || ("Bot " + (G.players.length + 1));
      G.players.push({ p: null, n, b: true, hand: [], s: 0, u: false });
      log(`${n} joined as a bot`); return true;
    }
    function addHuman(id, name) {
      if (G.players.length >= 8) return -1;
      G.players.push({ p: id, n: name, b: false, hand: [], s: 0, u: false });
      log(`${name} sat down`); return G.players.length - 1;
    }
    function removeSeat(i) {
      if (i < 0 || i >= N()) return;
      const host = G.players[G.hostSeat];
      G.players.splice(i, 1);
      G.hostSeat = Math.max(0, G.players.indexOf(host));
    }
    function startGame() {
      if (G.players.length < 2) return;
      G.players.forEach(p => { p.s = 0; });
      G.round = 0; G.dealer = Math.floor(Math.random() * N()); startRound();
    }
    function startRound() {
      G.round++; G.deck = buildDeck(G.mode); G.disc = []; G.rw = null; G.ch = null; G.uv = -1; G.dr = -1; G.dir = 1; G.pen = 0;
      G.players.forEach(p => { p.hand = []; p.u = false; });
      const d = G.dealer;
      for (let k = 0; k < 7; k++) for (let j = 1; j <= N(); j++) G.players[idx(d + j)].hand.push(G.deck.pop());
      let c;
      for (;;) { c = G.deck.pop(); if (c === "wf") { G.deck.unshift(c); shuffle(G.deck); continue; } break; }
      G.disc.push(c); G.top = c; G.col = c[0] === "w" ? null : c[0]; G.phase = "play";
      log(`Round ${G.round}: ${G.players[d].n} dealt. ${cardLabel(c)} starts the pile`);
      const first = idx(d + 1);
      switch (c[1]) {
        case "s": G.turn = idx(d + 2); log(`${G.players[first].n} is skipped`); break;
        case "r": G.dir = -1; G.turn = d; log("Play starts reversed, with the dealer"); break;
        case "d": drawCards(first, 2); G.turn = idx(d + 2); log(`${G.players[first].n} draws 2 and is skipped`); break;
        case "w": G.turn = first; if (!wild()) G.phase = "color"; break;
        default: G.turn = first; // includes a Wild Swap, which does nothing as the first card
      }
      ev({ ty: "deal" });
    }
    function newGame() {
      G.phase = "wait";
      const host = G.players[G.hostSeat];
      G.players = G.players.filter(p => !p.gone);
      G.hostSeat = Math.max(0, G.players.indexOf(host));
      G.players.forEach(p => { p.s = 0; p.hand = []; p.u = false; });
      G.rw = null; G.round = 0; G.top = null; G.uv = -1; G.ch = null; G.pen = 0;
    }
    function endRound(w) {
      let pts = 0; G.players.forEach((p, i) => { if (i !== w) pts += p.hand.reduce((a, c) => a + points(c, G.mode), 0); });
      G.players[w].s += pts; G.rw = { w, pts };
      G.phase = G.players[w].s >= G.target ? "over" : "round";
      G.dealer = idx(G.dealer + 1); G.uv = -1; G.ch = null; G.pen = 0;
      log(`${G.players[w].n} went out and scores ${pts}`);
    }
    function play(seat, i, c, col, uno, to) {
      // With stacking on, the target of a Wild Draw Four may answer it with their own.
      const restack = G.phase === "chal" && G.stack && G.ch && G.ch.to === seat && c === "wf";
      if (G.turn !== seat || (G.phase !== "play" && G.phase !== "drawn" && !restack)) return;
      if (G.phase === "drawn" && i !== G.dr) return;
      const p = G.players[seat];
      if (p.hand[i] !== c || !canPlay(c)) return;
      if (c[0] === "w" && !wild() && !COLORS.includes(col)) return;
      if (c === "wx" && (!(to >= 0 && to < N()) || to === seat)) return;
      clearUv(seat);
      const prev = G.col;
      const legal = c !== "wf" || !p.hand.some((x, j) => j !== i && x[0] === G.col);
      const stacked = G.pen > 0;
      // hit: cards the next player must draw. A classic Wild Draw Four goes through the challenge step instead.
      const hit = c[1] === "d" ? 2 : c === "wf" ? 4 : 0, chal = c === "wf" && !wild();
      p.hand.splice(i, 1); G.disc.push(c); G.top = c; G.col = wild() ? null : c[0] === "w" ? col : c[0]; G.dr = -1; G.phase = "play"; G.ch = null;
      if (hit && (G.stack || chal)) G.pen += hit;
      ev({ ty: "play", w: seat, c, pen: G.pen });
      const chose = c[0] === "w" && !wild() ? ` and chose ${CNAME[col]}` : "";
      log(stacked ? `${p.n} stacked a ${cardLabel(c)}${chose}. The stack is +${G.pen}` : `${p.n} played ${cardLabel(c)}${chose}`);
      if (p.hand.length === 1) { if (uno) { p.u = true; log(`${p.n} called UNO!`); ev({ ty: "uno", w: seat }); } else { p.u = false; G.uv = seat; } }
      const nx = idx(seat + G.dir);
      if (p.hand.length === 0) { // going out with a Wild Swap just goes out
        if (hit && !G.stack && !chal) drawCards(nx, hit);
        if (G.pen) { drawCards(nx, G.pen); G.pen = 0; }
        endRound(seat); return;
      }
      switch (c[1]) {
        case "s": log(`${G.players[nx].n} is skipped`); advance(2); break;
        case "r": G.dir *= -1; advance(N() === 2 ? 2 : 1); break;
        case "d": case "f":
          if (chal) { G.phase = "chal"; G.ch = { f: seat, to: nx, legal, pc: prev }; G.turn = nx; break; }
          if (G.stack) advance(1); // the next player stacks the same draw card or takes G.pen
          else { drawCards(nx, hit); log(`${G.players[nx].n} draws ${hit} and is skipped`); advance(2); }
          break;
        case "x": {
          const o = G.players[to];
          [p.hand, o.hand] = [o.hand, p.hand];
          p.u = p.hand.length === 1; o.u = o.hand.length === 1;
          if (G.uv === seat || G.uv === to) G.uv = -1;
          ev({ ty: "swap", w: seat, v: to });
          log(`${p.n} swapped hands with ${o.n}`);
          botEmote(to, [1, 2], 0.5);
          advance(1); break;
        }
        default: advance(1);
      }
    }
    function resolveChal(y) {
      if (G.phase !== "chal") return;
      // n is 4 for a single Wild Draw Four, more when several were stacked.
      const { f, to, legal } = G.ch, n = G.pen || 4; G.ch = null; G.pen = 0; G.phase = "play"; G.turn = to;
      const P = G.players;
      if (y) ev({ ty: "chal", w: to, ok: !legal });
      if (!y) { drawCards(to, n); log(`${P[to].n} took ${n} cards`); botEmote(to, [1, 2], 0.5); advance(1); }
      else if (legal) { drawCards(to, n + 2); log(`${P[to].n} challenged and lost, drawing ${n + 2}`); botEmote(to, [1, 2], 0.6); advance(1); }
      else { drawCards(f, n); log(`${P[to].n} caught ${P[f].n} bluffing. ${P[f].n} draws ${n}`); botEmote(to, [0, 4], 0.6); }
    }
    function handle(seat, a) {
      const p = G.players[seat]; if (!p || !a || typeof a !== "object") return;
      switch (a.t) {
        case "uno": if (G.uv === seat && p.hand.length === 1) { G.uv = -1; p.u = true; log(`${p.n} called UNO!`); ev({ ty: "uno", w: seat }); } break;
        case "catch": if (G.uv >= 0 && G.uv !== seat && a.k === G.uv) {
          const v = G.uv; G.uv = -1; ev({ ty: "catch", w: seat, v }); drawCards(v, 2);
          log(`${p.n} caught ${G.players[v].n} without UNO. +2`); botEmote(seat, [0, 5], 0.5);
        } break;
        case "emo": {
          const e = a.e | 0, now = Date.now();
          if (e < 0 || e > 5 || now - (p.emT || 0) < 900) return;
          p.emT = now; ev({ ty: "emo", w: seat, e }); break;
        }
        case "color": if (G.phase === "color" && G.turn === seat && COLORS.includes(a.col)) { G.col = a.col; G.phase = "play"; log(`${p.n} chose ${CNAME[a.col]}`); } break;
        case "chal": if (G.phase === "chal" && G.ch && G.ch.to === seat) resolveChal(!!a.y); break;
        case "draw":
          if (G.phase !== "play" || G.turn !== seat) return;
          clearUv(seat);
          if (G.pen) {
            const n = G.pen; G.pen = 0; drawCards(seat, n);
            log(`${p.n} took the stack: ${n} cards`); if (n >= 4) botEmote(seat, [1, 2], 0.6); advance(1); break;
          }
          if (drawCards(seat, 1)) {
            const c = p.hand[p.hand.length - 1];
            if (canPlay(c)) { G.phase = "drawn"; G.dr = p.hand.length - 1; }
            else { log(`${p.n} drew a card`); advance(1); }
          } else { log(`${p.n} had nothing to draw and passed`); advance(1); }
          break;
        case "pass": if (G.phase === "drawn" && G.turn === seat) { G.phase = "play"; G.dr = -1; log(`${p.n} drew and kept the card`); advance(1); } break;
        case "play": play(seat, a.i | 0, String(a.c || ""), a.col, !!a.uno, a.to == null ? -1 : a.to | 0); break;
      }
    }
    function bestColor(h) {
      const n = { r: 0, y: 0, g: 0, b: 0 }; h.forEach(c => { if (n[c[0]] != null) n[c[0]]++; });
      const m = Math.max(...Object.values(n));
      return m ? COLORS.filter(c => n[c] === m)[0] : COLORS[Math.floor(Math.random() * 4)];
    }
    function botStep() {
      if (G.phase === "chal") {
        const to = G.ch.to, bp = G.players[to]; if (!bp.b) return;
        const j = G.stack ? bp.hand.indexOf("wf") : -1;
        if (j >= 0 && Math.random() < 0.9) {
          handle(to, { t: "play", i: j, c: "wf", col: bestColor(bp.hand.filter((_, k) => k !== j)), uno: bp.hand.length === 2 && Math.random() < 0.85 });
          botEmote(to, [5, 3], 0.35); return;
        }
        resolveChal(Math.random() < 0.3); return;
      }
      const s = G.turn, p = G.players[s]; if (!p || !p.b) return;
      const uno = p.hand.length === 2 && Math.random() < 0.85;
      if (G.phase === "color") { handle(s, { t: "color", col: bestColor(p.hand) }); return; }
      // A Wild Swap is worth playing when someone else holds fewer cards than we would after playing it.
      let swapTo = -1, swapGain = -99;
      G.players.forEach((o, j) => { if (j !== s && (p.hand.length - 1) - o.hand.length > swapGain) { swapGain = (p.hand.length - 1) - o.hand.length; swapTo = j; } });
      const colFor = i => wild() ? null : bestColor(p.hand.filter((_, j) => j !== i));
      if (G.phase === "drawn") {
        const c = p.hand[G.dr];
        if (c === "wx" && swapGain < 2 && p.hand.length > 1) { handle(s, { t: "pass" }); return; }
        handle(s, { t: "play", i: G.dr, c, col: c[0] === "w" ? colFor(G.dr) : null, uno, to: swapTo }); return;
      }
      if (G.phase !== "play") return;
      const threat = G.players[idx(s + G.dir)].hand.length <= 2;
      const hasCol = p.hand.some(c => c[0] === G.col);
      const opts = p.hand.map((c, i) => ({ c, i })).filter(o => canPlay(o.c)).map(o => {
        const c = o.c; let sc;
        if (wild()) sc = c === "wx" ? (p.hand.length === 1 ? 50 : swapGain >= 2 ? 30 + swapGain * 5 : -99)
          : c === "wf" ? (threat ? 60 : 8) : "sdr".includes(c[1]) ? (threat ? 40 : 10) : 5;
        else if (c === "wf") sc = hasCol ? (Math.random() < 0.12 ? 3 : -99) : (threat ? 60 : 2);
        else if (c === "ww") sc = threat ? 18 : 1;
        else sc = 10 + (c[0] === G.col ? 4 : 0) + ("sdr".includes(c[1]) ? (threat ? 40 : 6) : +c[1] * 0.4);
        return { ...o, sc: sc + Math.random() * 2 };
      }).filter(o => o.sc > -50).sort((a, b) => b.sc - a.sc);
      if (!opts.length) { handle(s, { t: "draw" }); return; }
      const pick = opts[0];
      handle(s, { t: "play", i: pick.i, c: pick.c, col: pick.c[0] === "w" ? colFor(pick.i) : null, uno, to: swapTo });
    }
    function schedule() {
      clearTimeout(botTimer); botTimer = null;
      if (stopped) return;
      const actor = G.phase === "chal" ? G.ch.to : G.turn;
      if (["play", "drawn", "color", "chal"].includes(G.phase) && G.players[actor] && G.players[actor].b) {
        botTimer = setTimeout(() => { botStep(); onChange(); }, delay + rand(0, 650) + (G.uv >= 0 ? 1300 : 0));
      }
      if (G.uv >= 0 && !G.players[G.uv].b && !catchTimer) {
        const v = G.uv, bots = G.players.map((p, i) => p.b && i !== v ? i : -1).filter(i => i >= 0);
        if (bots.length) catchTimer = setTimeout(() => {
          catchTimer = null;
          if (!stopped && G.uv === v && Math.random() < 0.7) { handle(bots[Math.floor(Math.random() * bots.length)], { t: "catch", k: v }); onChange(); }
        }, rand(1700, 3400));
      }
    }
    /* What one viewer may see: only their own hand. */
    function snap(viewSeat) {
      return {
        ph: G.phase, code: G.code, tg: G.target, rd: G.round, hs: G.hostSeat, sk: G.stack ? 1 : 0, pen: G.pen, md: G.mode,
        pl: G.players.map((p, i) => {
          const o = { n: p.n, c: p.hand.length, s: p.s };
          if (p.b) o.b = 1; if (p.u) o.u = 1; if (p.gone) o.x = 1;
          if (i === viewSeat) o.h = p.hand.join("");
          return o;
        }),
        top: G.top, col: G.col, dir: G.dir, t: G.turn, dr: G.dr, uv: G.uv, dk: G.deck.length,
        ch: G.ch ? { f: G.ch.f, to: G.ch.to, pc: G.ch.pc } : null, lg: G.log.slice(-3), ev: G.evs.slice(-8), rw: G.rw
      };
    }
    function stop() { stopped = true; clearTimeout(botTimer); clearTimeout(catchTimer); }
    return { G, handle, addBot, addHuman, removeSeat, startGame, startRound, newGame, schedule, snap, stop, log };
  }
  Engine.cardLabel = cardLabel;
  Engine.MODES = MODES;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== "undefined" ? self : this);
