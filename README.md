# Last Card

A multiplayer card game played by the classic UNO rules. Players open a table, share a four-letter code or invite link, and play in real time. Bots can fill empty seats, and there's a solo practice mode.

Stacking is on by default: a Draw Two can be answered with another Draw Two, and a Wild Draw Four with another Wild Draw Four, until someone takes the whole penalty. The host can turn it off before dealing to play by the strict classic rules.

The host can also pick **Wild Rush**, a second mode where every card is a wild: Wild Skip, Wild Reverse, Wild Draw Two, Wild Draw Four and Wild Swap (trade hands with a player you choose). There's nothing to match and no colors to pick, so rounds are short and chaotic. Players can send quick emoji reactions, and the table has synthesized sound effects (the speaker button mutes them).

## Run it on your computer

You need Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To test multiplayer, open a second browser window (or a private window) and join with the table code.

## Put it online for free (Render)

1. Create a new GitHub repository and push this folder to it.
2. Sign in at https://render.com with GitHub and choose **New → Web Service**.
3. Pick your repository and use these settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Click **Create Web Service**. After a minute or two you'll get a public address like `https://last-card.onrender.com`. Share it with anyone.

Render's free tier goes to sleep after about 15 minutes with no visitors, so the first visit afterwards can take up to a minute to load. Tables live in the server's memory, so a restart or redeploy ends any games in progress.

Railway, Fly.io and Koyeb work the same way: they run `npm start` and provide the `PORT` environment variable, which the server already reads.

## How it's built

- `server.js` keeps every table, runs the game and the bots, and sends each player only their own hand, so nobody can peek at other people's cards.
- `public/engine.js` holds the rules. The server uses it for online tables and the browser uses it for practice games.
- `public/index.html` is the whole client: lobby, table, cards and animations.

If a player's connection drops, the browser rejoins automatically and they get their seat back. If they leave for good, a bot plays their hand. If the host leaves, hosting passes to the next player.