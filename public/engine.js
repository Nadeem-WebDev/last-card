/* Last Card game engine — classic UNO rules.
   Runs on the server for online tables and in the browser for practice games. */
(function (root) {
  "use strict";
  const COLORS = ["r", "y", "g", "b"];
  const CNAME = { r: "Red", y: "Yellow", g: "Green", b: "Blue" };
  const BOTN = ["Mara", "Juno", "Otis", "Pip", "Rook", "Wren", "Ines", "Taro", "Sol", "Bea", "Kit", "Lumi"];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rand = (a, b) => a + Math.random() * (b - a);
  const points = c => c[0] === "w" ? 50 : "srd".includes(c[1]) ? 20 : +c[1];
  function cardLabel(c) {
    const v = c[1], col = c[0];
    const vn = v === "s" ? "Skip" : v === "r" ? "Reverse" : v === "d" ? "Draw Two" : v === "w" ? "Wild" : v === "f" ? "Wild Draw Four" : v;
    return col === "w" ? vn : `${CNAME[col]} ${vn}`;
  }
  function buildDeck() {
    const d = [];
    for (const c of COLORS) { d.push(c + "0"); for (let n = 1; n <= 9; n++) d.push(c + n, c + n); for (const a of "srd") d.push(c + a, c + a); }
    for (let i = 0; i < 4; i++) d.push("ww", "wf");
    return shuffle(d);
  }

  function Engine(code, hostId, hostName, opts) {
    opts = opts || {};
    const G = {
      code, phase: "wait", players: [{ p: hostId, n: hostName || "Host", b: false, hand: [], s: 0, u: false }],
      deck: [], disc: [], top: null, col: null, dir: 1, turn: 0, dr: -1, ch: null, uv: -1,
      log: [], evs: [], evk: 0, target: 250, round: 0, dealer: 0, rw: null, hostSeat: 0
    };
    let botTimer = null, catchTimer = null, stopped = false;
    const onChange = opts.onChange || (() => {});
    const delay = opts.botDelay || 850;

    const N = () => G.players.length;
    const idx = i => ((i % N()) + N()) % N();
    const log = t => { G.log.push(t); if (G.log.length > 6) G.log.shift(); };
    const ev = o => { o.k = ++G.evk; G.evs.push(o); if (G.evs.length > 6) G.evs.shift(); };
    const canPlay = c => c[0] === "w" || c[0] === G.col || c[1] === G.top[1];
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
      G.round++; G.deck = buildDeck(); G.disc = []; G.rw = null; G.ch = null; G.uv = -1; G.dr = -1; G.dir = 1;
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
        case "w": G.turn = first; G.phase = "color"; break;
        default: G.turn = first;
      }
      ev({ ty: "deal" });
    }
    function newGame() {
      G.phase = "wait";
      const host = G.players[G.hostSeat];
      G.players = G.players.filter(p => !p.gone);
      G.hostSeat = Math.max(0, G.players.indexOf(host));
      G.players.forEach(p => { p.s = 0; p.hand = []; p.u = false; });
      G.rw = null; G.round = 0; G.top = null; G.uv = -1; G.ch = null;
    }
    function endRound(w) {
      let pts = 0; G.players.forEach((p, i) => { if (i !== w) pts += p.hand.reduce((a, c) => a + points(c), 0); });
      G.players[w].s += pts; G.rw = { w, pts };
      G.phase = G.players[w].s >= G.target ? "over" : "round";
      G.dealer = idx(G.dealer + 1); G.uv = -1; G.ch = null;
      log(`${G.players[w].n} went out and scores ${pts}`);
    }
    function play(seat, i, c, col, uno) {
      if (G.turn !== seat || (G.phase !== "play" && G.phase !== "drawn")) return;
      if (G.phase === "drawn" && i !== G.dr) return;
      const p = G.players[seat];
      if (p.hand[i] !== c || !canPlay(c)) return;
      if (c[0] === "w" && !COLORS.includes(col)) return;
      clearUv(seat);
      const prev = G.col;
      const legal = c !== "wf" || !p.hand.some((x, j) => j !== i && x[0] === G.col);
      p.hand.splice(i, 1); G.disc.push(c); G.top = c; G.col = c[0] === "w" ? col : c[0]; G.dr = -1; G.phase = "play";
      ev({ ty: "play", w: seat, c });
      log(`${p.n} played ${cardLabel(c)}${c[0] === "w" ? ` and chose ${CNAME[col]}` : ""}`);
      if (p.hand.length === 1) { if (uno) { p.u = true; log(`${p.n} called UNO!`); } else { p.u = false; G.uv = seat; } }
      const nx = idx(seat + G.dir);
      if (p.hand.length === 0) {
        if (c[1] === "d") drawCards(nx, 2);
        if (c === "wf") drawCards(nx, 4);
        endRound(seat); return;
      }
      switch (c[1]) {
        case "s": log(`${G.players[nx].n} is skipped`); advance(2); break;
        case "r": G.dir *= -1; advance(N() === 2 ? 2 : 1); break;
        case "d": drawCards(nx, 2); log(`${G.players[nx].n} draws 2 and is skipped`); advance(2); break;
        case "f": G.phase = "chal"; G.ch = { f: seat, to: nx, legal, pc: prev }; G.turn = nx; break;
        default: advance(1);
      }
    }
    function resolveChal(y) {
      if (G.phase !== "chal") return;
      const { f, to, legal } = G.ch; G.ch = null; G.phase = "play"; G.turn = to;
      const P = G.players;
      if (!y) { drawCards(to, 4); log(`${P[to].n} took 4 cards`); advance(1); }
      else if (legal) { drawCards(to, 6); log(`${P[to].n} challenged and lost, drawing 6`); advance(1); }
      else { drawCards(f, 4); log(`${P[to].n} caught ${P[f].n} bluffing. ${P[f].n} draws 4`); }
    }
    function handle(seat, a) {
      const p = G.players[seat]; if (!p || !a || typeof a !== "object") return;
      switch (a.t) {
        case "uno": if (G.uv === seat && p.hand.length === 1) { G.uv = -1; p.u = true; log(`${p.n} called UNO!`); } break;
        case "catch": if (G.uv >= 0 && G.uv !== seat && a.k === G.uv) { const v = G.uv; G.uv = -1; drawCards(v, 2); log(`${p.n} caught ${G.players[v].n} without UNO. +2`); } break;
        case "color": if (G.phase === "color" && G.turn === seat && COLORS.includes(a.col)) { G.col = a.col; G.phase = "play"; log(`${p.n} chose ${CNAME[a.col]}`); } break;
        case "chal": if (G.phase === "chal" && G.ch && G.ch.to === seat) resolveChal(!!a.y); break;
        case "draw":
          if (G.phase !== "play" || G.turn !== seat) return;
          clearUv(seat);
          if (drawCards(seat, 1)) {
            const c = p.hand[p.hand.length - 1];
            if (canPlay(c)) { G.phase = "drawn"; G.dr = p.hand.length - 1; }
            else { log(`${p.n} drew a card`); advance(1); }
          } else { log(`${p.n} had nothing to draw and passed`); advance(1); }
          break;
        case "pass": if (G.phase === "drawn" && G.turn === seat) { G.phase = "play"; G.dr = -1; log(`${p.n} drew and kept the card`); advance(1); } break;
        case "play": play(seat, a.i | 0, String(a.c || ""), a.col, !!a.uno); break;
      }
    }
    function bestColor(h) {
      const n = { r: 0, y: 0, g: 0, b: 0 }; h.forEach(c => { if (n[c[0]] != null) n[c[0]]++; });
      const m = Math.max(...Object.values(n));
      return m ? COLORS.filter(c => n[c] === m)[0] : COLORS[Math.floor(Math.random() * 4)];
    }
    function botStep() {
      if (G.phase === "chal") { if (G.players[G.ch.to].b) resolveChal(Math.random() < 0.3); return; }
      const s = G.turn, p = G.players[s]; if (!p || !p.b) return;
      const uno = p.hand.length === 2 && Math.random() < 0.85;
      if (G.phase === "color") { handle(s, { t: "color", col: bestColor(p.hand) }); return; }
      if (G.phase === "drawn") { const c = p.hand[G.dr]; handle(s, { t: "play", i: G.dr, c, col: c[0] === "w" ? bestColor(p.hand.filter((_, j) => j !== G.dr)) : null, uno }); return; }
      if (G.phase !== "play") return;
      const threat = G.players[idx(s + G.dir)].hand.length <= 2;
      const hasCol = p.hand.some(c => c[0] === G.col);
      const opts = p.hand.map((c, i) => ({ c, i })).filter(o => canPlay(o.c)).map(o => {
        const c = o.c; let sc;
        if (c === "wf") sc = hasCol ? (Math.random() < 0.12 ? 3 : -99) : (threat ? 60 : 2);
        else if (c === "ww") sc = threat ? 18 : 1;
        else sc = 10 + (c[0] === G.col ? 4 : 0) + ("sdr".includes(c[1]) ? (threat ? 40 : 6) : +c[1] * 0.4);
        return { ...o, sc: sc + Math.random() * 2 };
      }).filter(o => o.sc > -50).sort((a, b) => b.sc - a.sc);
      if (!opts.length) { handle(s, { t: "draw" }); return; }
      const pick = opts[0];
      handle(s, { t: "play", i: pick.i, c: pick.c, col: pick.c[0] === "w" ? bestColor(p.hand.filter((_, j) => j !== pick.i)) : null, uno });
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
        ph: G.phase, code: G.code, tg: G.target, rd: G.round, hs: G.hostSeat,
        pl: G.players.map((p, i) => {
          const o = { n: p.n, c: p.hand.length, s: p.s };
          if (p.b) o.b = 1; if (p.u) o.u = 1; if (p.gone) o.x = 1;
          if (i === viewSeat) o.h = p.hand.join("");
          return o;
        }),
        top: G.top, col: G.col, dir: G.dir, t: G.turn, dr: G.dr, uv: G.uv, dk: G.deck.length,
        ch: G.ch ? { f: G.ch.f, to: G.ch.to, pc: G.ch.pc } : null, lg: G.log.slice(-3), ev: G.evs.slice(-5), rw: G.rw
      };
    }
    function stop() { stopped = true; clearTimeout(botTimer); clearTimeout(catchTimer); }
    return { G, handle, addBot, addHuman, removeSeat, startGame, startRound, newGame, schedule, snap, stop, log };
  }
  Engine.cardLabel = cardLabel;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== "undefined" ? self : this);
