let memStore = { pv: 0, choices: 0, endings: {} };

async function redisCmd(cmdArgs) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmdArgs)
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const hasRedis = Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { type, endingId } = body;
      if (hasRedis) {
        if (type === 'visit') await redisCmd(['INCR', 'jensen:pv']);
        if (type === 'choice') await redisCmd(['INCR', 'jensen:choices']);
        if (type === 'ending' && endingId) await redisCmd(['HINCRBY', 'jensen:endings', String(endingId), 1]);
      } else {
        if (type === 'visit') memStore.pv += 1;
        if (type === 'choice') memStore.choices += 1;
        if (type === 'ending' && endingId) memStore.endings[endingId] = (memStore.endings[endingId] || 0) + 1;
      }
    }
    if (hasRedis) {
      const [pvRaw, choicesRaw, endingsRaw] = await Promise.all([
        redisCmd(['GET', 'jensen:pv']),
        redisCmd(['GET', 'jensen:choices']),
        redisCmd(['HGETALL', 'jensen:endings'])
      ]);
      const endings = {};
      if (Array.isArray(endingsRaw)) {
        for (let i = 0; i < endingsRaw.length; i += 2) endings[endingsRaw[i]] = Number(endingsRaw[i + 1] || 0);
      }
      return res.status(200).json({ mode: 'redis', pv: Number(pvRaw || 0), choices: Number(choicesRaw || 0), endings });
    }
    return res.status(200).json({ mode: 'memory', pv: memStore.pv, choices: memStore.choices, endings: memStore.endings });
  } catch (err) {
    return res.status(500).json({ error: 'Telemetry error' });
  }
}
