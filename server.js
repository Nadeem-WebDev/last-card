const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const Engine = require("./public/engine.js");

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.send("ok"));
const server = http.createServer(app);
const io = new Server(server);

/** code -> { code, E, hostId, members: Map<socketId, name> } */
const tables = new Map();
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const cleanName = s => String(s || "").replace(/[^\p{L}\p{N} ._'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
function newCode() {
  let c;
  do { c = ""; for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]; } while (tables.has(c));
  return c;
}
const seatOf = (t, sid) => t.E.G.players.findIndex(p => p.p === sid);

function lobbyList() {
  return [...tables.values()].map(t => {
    const G = t.E.G;
    return { c: t.code, h: (G.players[G.hostSeat] || {}).n || "Someone", k: G.players.filter(p => !p.b).length, s: G.phase === "wait" ? 0 : 1 };
  });
}
let lobbyTimer = null;
function pushLobby() {
  clearTimeout(lobbyTimer);
  lobbyTimer = setTimeout(() => io.emit("tables", lobbyList()), 250);
}
function broadcast(t) {
  for (const sid of t.members.keys()) {
    const seat = seatOf(t, sid);
    io.to(sid).emit("state", { ...t.E.snap(seat), you: seat, host: sid === t.hostId });
  }
  t.E.schedule();
  pushLobby();
}

function leaveTable(socket) {
  const code = socket.data.code; if (!code) return;
  socket.data.code = null;
  const t = tables.get(code); if (!t) return;
  t.members.delete(socket.id);
  const G = t.E.G, seat = seatOf(t, socket.id);
  if (seat >= 0) {
    const p = G.players[seat];
    if (G.phase === "wait") { t.E.removeSeat(seat); t.E.log(`${p.n} left`); }
    else { p.b = true; p.gone = true; p.p = null; t.E.log(`${p.n} left. A bot is playing their hand`); }
  }
  const humans = [...t.members.keys()];
  if (!humans.length) { t.E.stop(); tables.delete(code); pushLobby(); return; }
  if (t.hostId === socket.id) {
    // Hand hosting to the next seated person, or anyone still watching.
    const next = humans.find(id => seatOf(t, id) >= 0) || humans[0];
    t.hostId = next;
    const ns = seatOf(t, next);
    if (ns >= 0) G.hostSeat = ns;
    t.E.log(`${t.members.get(next)} is now hosting`);
  } else {
    const hs = seatOf(t, t.hostId); if (hs >= 0) G.hostSeat = hs;
  }
  broadcast(t);
}

function seatPerson(t, sid, name) {
  const G = t.E.G;
  if (G.phase === "wait") return t.E.addHuman(sid, name);
  // Mid-game: take back a seat that a bot is covering for someone with this name.
  const r = G.players.findIndex(p => p.gone && p.n.toLowerCase() === name.toLowerCase());
  if (r >= 0) { Object.assign(G.players[r], { p: sid, b: false, gone: false }); t.E.log(`${name} is back at the table`); }
  return r;
}

io.on("connection", socket => {
  socket.emit("tables", lobbyList());

  socket.on("create", (msg, cb) => {
    cb = typeof cb === "function" ? cb : () => {};
    const name = cleanName(msg && msg.name);
    if (!name) return cb({ err: "Add your name first" });
    leaveTable(socket);
    const code = newCode();
    const t = { code, hostId: socket.id, members: new Map([[socket.id, name]]) };
    t.E = Engine(code, socket.id, name, { onChange: () => broadcast(t) });
    tables.set(code, t);
    socket.data.code = code;
    cb({ ok: true, code });
    broadcast(t);
  });

  socket.on("join", (msg, cb) => {
    cb = typeof cb === "function" ? cb : () => {};
    const name = cleanName(msg && msg.name), code = cleanCode(msg && msg.code);
    if (!name) return cb({ err: "Add your name first" });
    const t = tables.get(code);
    if (!t) return cb({ err: `No table called ${code || "that"}. Check the code and try again.` });
    if (socket.data.code !== code) leaveTable(socket);
    if (!t.members.has(socket.id)) {
      t.members.set(socket.id, name);
      seatPerson(t, socket.id, name);
      socket.data.code = code;
    }
    cb({ ok: true, code });
    broadcast(t);
  });

  socket.on("act", a => {
    const t = tables.get(socket.data.code); if (!t) return;
    const seat = seatOf(t, socket.id); if (seat < 0) return;
    t.E.handle(seat, a);
    broadcast(t);
  });

  socket.on("cmd", m => {
    const t = tables.get(socket.data.code); if (!t || t.hostId !== socket.id || !m) return;
    const E = t.E, G = E.G;
    switch (m.c) {
      case "addbot": if (G.phase === "wait") E.addBot(); break;
      case "kick": { const i = m.i | 0; if (G.phase === "wait" && G.players[i] && G.players[i].b) E.removeSeat(i); break; }
      case "target": if (G.phase === "wait" && [100, 250, 500].includes(+m.v)) G.target = +m.v; break;
      case "stack": if (G.phase === "wait") G.stack = !!m.v; break;
      case "mode": if (G.phase === "wait" && Engine.MODES.includes(m.v)) G.mode = m.v; break;
      case "start": if (G.phase === "wait") E.startGame(); break;
      case "next": if (G.phase === "round") E.startRound(); break;
      case "newgame":
        if (G.phase === "over" || G.phase === "round") {
          E.newGame();
          for (const [sid, name] of t.members) if (seatOf(t, sid) < 0) E.addHuman(sid, name);
          const hs = seatOf(t, t.hostId); if (hs >= 0) G.hostSeat = hs;
        }
        break;
      default: return;
    }
    broadcast(t);
  });

  socket.on("leave", () => leaveTable(socket));
  socket.on("disconnect", () => leaveTable(socket));
});

server.listen(PORT, () => console.log(`Last Card is running on http://localhost:${PORT}`));
