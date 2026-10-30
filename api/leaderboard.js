// Adich Keri Vaa! worldwide leaderboard (Vercel serverless function).
// Needs an Upstash Redis database connected to the Vercel project
// (Vercel dashboard > Storage > Upstash for Redis). Either pair of env vars works:
//   KV_REST_API_URL + KV_REST_API_TOKEN   or   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOARD = 'akv:lb';

async function redis(cmds) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}
const int = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'leaderboard_not_configured' });
  try {
    if (req.method === 'GET') {
      const [flat] = await redis([['ZREVRANGE', BOARD, '0', '49', 'WITHSCORES']]);
      const ids = []; const scores = [];
      for (let i = 0; i < (flat || []).length; i += 2) { ids.push(flat[i]); scores.push(Number(flat[i + 1])); }
      if (!ids.length) return res.status(200).json({ players: [] });
      const rows = await redis(ids.map(id => ['HMGET', 'akv:p:' + id, 'name', 'hits', 'combo', 'badges']));
      const players = ids.map((id, i) => {
        const [name, hits, combo, badges] = rows[i] || [];
        return { id, name: name || 'Player', score: scores[i], hits: Number(hits) || 0, combo: Number(combo) || 0, badges: Number(badges) || 0 };
      });
      return res.status(200).json({ players });
    }
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      b = b || {};
      const id = String(b.id || '');
      if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
      const name = String(b.name || 'Player').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';
      const hits = int(b.hits, 5e6), combo = int(b.combo, 1e5), badges = int(b.badges, 64);
      const score = Math.min(int(b.score, 5e8), hits * 600 + 1000); // keep scores believable for the hit count
      const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
      const [ok] = await redis([['SET', 'akv:rl:' + ip, '1', 'NX', 'EX', '3']]);
      if (ok !== 'OK') return res.status(429).json({ error: 'slow_down' });
      await redis([
        ['ZADD', BOARD, 'GT', String(score), id],
        ['HSET', 'akv:p:' + id, 'name', name, 'hits', String(hits), 'combo', String(combo), 'badges', String(badges), 't', String(Date.now())],
      ]);
      const [rank] = await redis([['ZREVRANK', BOARD, id]]);
      return res.status(200).json({ ok: true, rank: rank == null ? null : rank + 1 });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
};
