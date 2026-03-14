require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/market ──────────────────────────────────────────────────────────
app.get('/api/market', async (req, res) => {
  try {
    const [ticker, klines, depth, chain] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=48'),
      axios.get('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20'),
      axios.get('https://api.blockchain.info/stats').catch(() => ({ data: null })),
    ]);

    res.json({
      ticker: ticker.data,
      klines: klines.data,
      depth: depth.data,
      chain: chain.data,
    });
  } catch (err) {
    console.error('Market fetch error:', err.message);
    res.status(502).json({ error: 'Failed to fetch market data', detail: err.message });
  }
});

// ── POST /api/predict ────────────────────────────────────────────────────────
app.post('/api/predict', async (req, res) => {
  const { marketData } = req.body;
  if (!marketData) return res.status(400).json({ error: 'marketData required' });

  const { ticker, klines, depth, chain } = marketData;

  // Build concise context for Claude
  const currentPrice = parseFloat(ticker.lastPrice);
  const priceChange = parseFloat(ticker.priceChangePercent);
  const volume24h = parseFloat(ticker.quoteVolume).toFixed(0);

  // Compute momentum across timeframes from klines
  const closes = klines.map(k => parseFloat(k[4]));
  const latest = closes[closes.length - 1];
  const m15 = ((latest - closes[closes.length - 2]) / closes[closes.length - 2] * 100).toFixed(3);
  const m1h = ((latest - closes[closes.length - 5]) / closes[closes.length - 5] * 100).toFixed(3);
  const m6h = ((latest - closes[closes.length - 25]) / closes[closes.length - 25] * 100).toFixed(3);
  const m12h = ((latest - closes[closes.length - 49 < 0 ? 0 : closes.length - 49]) / closes[0] * 100).toFixed(3);
  const m24h = priceChange.toFixed(3);

  const bidVol = depth.bids.reduce((s, [, q]) => s + parseFloat(q), 0).toFixed(2);
  const askVol = depth.asks.reduce((s, [, q]) => s + parseFloat(q), 0).toFixed(2);
  const bidPct = (bidVol / (parseFloat(bidVol) + parseFloat(askVol)) * 100).toFixed(1);

  const chainStr = chain
    ? `hash_rate=${chain.hash_rate}, difficulty=${chain.difficulty}, mempool_size=${chain.mempool_size}, transactions_per_second=${chain.transactions_per_second?.toFixed(2)}`
    : 'unavailable';

  const prompt = `You are a professional crypto trading analyst. Analyze Bitcoin and return ONLY a JSON object matching the schema below — no markdown, no commentary.

MARKET DATA:
- Price: $${currentPrice.toLocaleString()} (24h change: ${priceChange}%)
- Volume 24h: $${parseInt(volume24h).toLocaleString()}
- Momentum: 15m=${m15}%, 1h=${m1h}%, 6h=${m6h}%, 12h=${m12h}%, 24h=${m24h}%
- Order book: ${bidPct}% bid pressure (bids=${bidVol} BTC, asks=${askVol} BTC)
- On-chain: ${chainStr}
- Recent 15m closes (last 12): ${closes.slice(-12).map(p => '$' + p.toLocaleString()).join(', ')}

REQUIRED JSON SCHEMA:
{
  "trend": {
    "direction": "BULLISH|BEARISH|SIDEWAYS",
    "strength": "STRONG|MODERATE|WEAK",
    "duration": "<estimated trend duration>",
    "momentum": <0-100 integer>,
    "key_level": "<key support/resistance price>",
    "description": "<2-3 sentence trend summary>"
  },
  "pred_15": {
    "price": <number>,
    "direction": "UP|DOWN|NEUTRAL",
    "confidence": <0-100>,
    "change_pct": <float>,
    "trend_alignment": "WITH|AGAINST|NEUTRAL"
  },
  "pred_hour": {
    "price": <number>,
    "direction": "UP|DOWN|NEUTRAL",
    "confidence": <0-100>,
    "change_pct": <float>,
    "trend_alignment": "WITH|AGAINST|NEUTRAL"
  },
  "signals": ["<signal1>", "<signal2>", "<signal3>"],
  "headlines": ["<headline1>", "<headline2>"],
  "reasoning": "<concise analysis paragraph>"
}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 1,
        },
      ],
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract JSON from response
    let jsonText = '';
    for (const block of message.content) {
      if (block.type === 'text') {
        jsonText = block.text;
        break;
      }
    }

    // Strip markdown fences if present
    jsonText = jsonText.replace(/```(?:json)?\n?/g, '').trim();

    let prediction;
    try {
      prediction = JSON.parse(jsonText);
    } catch {
      // Try to extract JSON object from text
      const match = jsonText.match(/\{[\s\S]*\}/);
      if (match) prediction = JSON.parse(match[0]);
      else throw new Error('Could not parse prediction JSON');
    }

    res.json(prediction);
  } catch (err) {
    console.error('Predict error:', err.message);
    res.status(500).json({ error: 'Prediction failed', detail: err.message });
  }
});

// ── POST /api/backtest ───────────────────────────────────────────────────────
app.post('/api/backtest', async (req, res) => {
  const { klines } = req.body;
  if (!klines || !Array.isArray(klines)) return res.status(400).json({ error: 'klines array required' });

  // Build compact candle summary for Claude
  const candles = klines.map(k => ({
    t: new Date(k[0]).toISOString().slice(11, 16),
    o: parseFloat(k[1]).toFixed(2),
    h: parseFloat(k[2]).toFixed(2),
    l: parseFloat(k[3]).toFixed(2),
    c: parseFloat(k[4]).toFixed(2),
    v: parseFloat(k[5]).toFixed(2),
  }));

  const prompt = `You are a quant analyst. Backtest a simple momentum strategy on these 48x15m BTC candles:
RULE: Enter LONG when 3 consecutive closes rise; enter SHORT when 3 consecutive closes fall. Exit after 2 candles.

CANDLES (time, open, high, low, close, volume):
${candles.map(c => `${c.t} O=${c.o} H=${c.h} L=${c.l} C=${c.c} V=${c.v}`).join('\n')}

Return ONLY a JSON object:
{
  "trades": [
    { "entry_time": "HH:MM", "direction": "LONG|SHORT", "entry_price": number, "exit_price": number, "pnl_pct": float, "result": "WIN|LOSS" }
  ],
  "summary": {
    "total_trades": number,
    "wins": number,
    "losses": number,
    "win_rate": float,
    "total_pnl_pct": float,
    "avg_win_pct": float,
    "avg_loss_pct": float,
    "best_trade_pct": float,
    "worst_trade_pct": float
  },
  "assessment": "<2-3 sentence strategy assessment>"
}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    let jsonText = message.content[0].text.replace(/```(?:json)?\n?/g, '').trim();
    let result;
    try {
      result = JSON.parse(jsonText);
    } catch {
      const match = jsonText.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
      else throw new Error('Could not parse backtest JSON');
    }

    // Attach candle data for table display
    result.candles = candles;
    res.json(result);
  } catch (err) {
    console.error('Backtest error:', err.message);
    res.status(500).json({ error: 'Backtest failed', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`BTC Terminal running on http://localhost:${PORT}`);
});
