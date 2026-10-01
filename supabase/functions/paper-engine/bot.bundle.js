// src/indicators.ts
var closes = (c) => c.map((x) => x.close);
function smaValues(v, period) {
  const out = new Array(v.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= period) sum -= v[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
function emaValues(v, period) {
  const out = new Array(v.length).fill(NaN);
  if (v.length < period) return out;
  const k = 2 / (period + 1);
  let prev = v.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function wilder(v, period, start) {
  const out = new Array(v.length).fill(NaN);
  if (v.length < start + period) return out;
  let prev = 0;
  for (let i = start; i < start + period; i++) prev += v[i];
  prev /= period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < v.length; i++) {
    prev = (prev * (period - 1) + v[i]) / period;
    out[i] = prev;
  }
  return out;
}
function rsiValues(v, period = 14) {
  const gains = v.map((x, i) => i === 0 ? 0 : Math.max(x - v[i - 1], 0));
  const losses = v.map((x, i) => i === 0 ? 0 : Math.max(v[i - 1] - x, 0));
  const g = wilder(gains, period, 1);
  const l = wilder(losses, period, 1);
  return g.map((gi, i) => Number.isNaN(gi) ? NaN : l[i] === 0 ? 100 : 100 - 100 / (1 + gi / l[i]));
}
var trueRange = (c) => c.map(
  (x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))
);
function atrValues(c, period = 14) {
  return wilder(trueRange(c), period, 1);
}
function adxValues(c, period = 14) {
  const plusDM = c.map((x, i) => {
    if (i === 0) return 0;
    const up = x.high - c[i - 1].high;
    const down = c[i - 1].low - x.low;
    return up > down && up > 0 ? up : 0;
  });
  const minusDM = c.map((x, i) => {
    if (i === 0) return 0;
    const up = x.high - c[i - 1].high;
    const down = c[i - 1].low - x.low;
    return down > up && down > 0 ? down : 0;
  });
  const tr = wilder(trueRange(c), period, 1);
  const pdm = wilder(plusDM, period, 1);
  const mdm = wilder(minusDM, period, 1);
  const dx = tr.map((t, i) => {
    if (Number.isNaN(t) || t === 0) return NaN;
    const pdi = 100 * pdm[i] / t;
    const mdi = 100 * mdm[i] / t;
    return pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi);
  });
  const first = dx.findIndex((x) => !Number.isNaN(x));
  if (first < 0) return dx;
  const adx = wilder(dx.slice(first), period, 0);
  return [...new Array(first).fill(NaN), ...adx];
}
function swings(c, n = 5) {
  const out = [];
  for (let i = n; i < c.length - n; i++) {
    let high = true;
    let low = true;
    for (let j = i - n; j <= i + n && (high || low); j++) {
      if (j === i) continue;
      if (j < i ? c[j].high >= c[i].high : c[j].high > c[i].high) high = false;
      if (j < i ? c[j].low <= c[i].low : c[j].low < c[i].low) low = false;
    }
    if (high) out.push({ index: i, confirmedAt: i + n, price: c[i].high, type: "high" });
    if (low) out.push({ index: i, confirmedAt: i + n, price: c[i].low, type: "low" });
  }
  return out;
}

// src/strategies.ts
var barSeconds = (c) => c.length > 1 ? c[1].time - c[0].time : 86400;
var warmupOf = (s, c) => s.warmupFor?.(barSeconds(c)) ?? s.warmup;
var crossUp = (a, b, i) => a[i - 1] <= b[i - 1] && a[i] > b[i];
var crossDown = (a, b, i) => a[i - 1] >= b[i - 1] && a[i] < b[i];
var EMA_DEFAULTS = { fast: 20, slow: 50, atrMult: 2.5 };
function makeEmaTrend(p = EMA_DEFAULTS) {
  const { fast, slow, atrMult: M } = p;
  const isDefault = fast === EMA_DEFAULTS.fast && slow === EMA_DEFAULTS.slow && M === EMA_DEFAULTS.atrMult;
  return {
    id: isDefault ? "ema-trend" : `ema-trend-${fast}-${slow}-${M}`,
    name: isDefault ? "Filtrert EMA-trend" : `EMA-trend ${fast}/${slow}`,
    interval: "4h",
    rules: [
      `Kj\xF8p: EMA ${fast} krysser over EMA ${slow} og kursen er over SMA 200`,
      `Short: EMA ${fast} krysser under EMA ${slow}, kursen under SMA 200 og ADX > 20`,
      `Stop: ${String(M).replace(".", ",")} \xD7 ATR, flyttes etter kursen (trailing)`,
      "Exit: stop eller motsatt EMA-kryss"
    ],
    warmup: Math.max(200, slow),
    trailAtr: M,
    prepare(c, { allowShort }) {
      const cl = closes(c);
      const eF = emaValues(cl, fast);
      const eS = emaValues(cl, slow);
      const s200 = smaValues(cl, 200);
      const atr = atrValues(c, 14);
      const adx = adxValues(c, 14);
      return {
        decide(i, pos) {
          const close = cl[i];
          if (pos) {
            if (pos.side === "long" && crossDown(eF, eS, i)) return { type: "exit", reason: "EMA-kryss ned" };
            if (pos.side === "short" && crossUp(eF, eS, i)) return { type: "exit", reason: "EMA-kryss opp" };
            const trail = pos.side === "long" ? Math.max(pos.stop, close - M * atr[i]) : Math.min(pos.stop, close + M * atr[i]);
            return trail !== pos.stop ? { type: "stop", stop: trail } : null;
          }
          if (crossUp(eF, eS, i) && close > s200[i])
            return { type: "enter", side: "long", stop: close - M * atr[i], reason: `EMA ${fast}/${slow} kryss opp over SMA 200` };
          if (allowShort && crossDown(eF, eS, i) && close < s200[i] && adx[i] > 20)
            return { type: "enter", side: "short", stop: close + M * atr[i], reason: `EMA ${fast}/${slow} kryss ned under SMA 200` };
          return null;
        }
      };
    }
  };
}
var emaTrend = makeEmaTrend();
var REGIME_DAYS = 50;
var REGIME_BUFFER = 0.03;
var regimeBars = (sec) => Math.max(1, Math.round(REGIME_DAYS * 86400 / sec));
var trendRegime = {
  id: "trend-regime",
  name: "Trendregime (hold, men unng\xE5 nedtrender)",
  interval: "1d",
  rules: [
    `Inne (long) n\xE5r kursen lukker over ${REGIME_DAYS}-dagers snitt`,
    `Ut i cash n\xE5r kursen lukker mer enn ${REGIME_BUFFER * 100} % under snittet`,
    "Ingen stop, ingen short: m\xE5let er \xE5 fange oppturene og slippe de store fallene"
  ],
  warmup: REGIME_DAYS,
  warmupFor: regimeBars,
  prepare(c) {
    const cl = closes(c);
    const ma = smaValues(cl, regimeBars(barSeconds(c)));
    return {
      decide(i, pos) {
        if (Number.isNaN(ma[i])) return null;
        if (pos) return cl[i] < ma[i] * (1 - REGIME_BUFFER) ? { type: "exit", reason: `Under ${REGIME_DAYS}d-snitt` } : null;
        return cl[i] > ma[i] ? { type: "enter", side: "long", stop: 0, reason: `Over ${REGIME_DAYS}d-snitt` } : null;
      }
    };
  }
};
function makeFvgStructure(p = {}) {
  const fmt = (n) => String(n).replace(".", ",");
  const stopRule = p.maxStopAtr ? ` Hopper over oppsett der stopen er mer enn ${fmt(p.maxStopAtr)} \xD7 ATR unna.` : "";
  const targetRule = p.maxTargetAtr ? `M\xE5l: 2R, men maks ${fmt(p.maxTargetAtr)} \xD7 ATR` : "M\xE5l: 2 \xD7 risikoen (2R)";
  const variant = [p.maxStopAtr && `stop\u2264${p.maxStopAtr}`, p.maxTargetAtr && `m\xE5l\u2264${p.maxTargetAtr}`].filter(Boolean).join("-");
  return {
    id: variant ? `fvg-structure-${variant}` : "fvg-structure",
    name: "FVG-retest i trendretning",
    interval: "1h",
    rules: [
      "Struktur: brudd over siste bekreftede topp = opptrend, under siste bunn = nedtrend",
      "Kj\xF8p: i opptrend, kursen tester et \xE5pent bullish FVG og lukker over det",
      "Short: i nedtrend, kursen tester et \xE5pent bearish FVG og lukker under det",
      `Stop: rett utenfor gapet.${stopRule} ${targetRule}. Exit ogs\xE5 hvis strukturen snur`
    ],
    warmup: 50,
    prepare(c, { allowShort }) {
      const atr = atrValues(c, 14);
      const N = 5;
      const byConfirm = /* @__PURE__ */ new Map();
      for (const s of swings(c, N)) byConfirm.set(s.confirmedAt, [...byConfirm.get(s.confirmedAt) ?? [], s]);
      let trend = null;
      let lastHigh = null;
      let lastLow = null;
      let gaps = [];
      return {
        update(i) {
          for (const s of byConfirm.get(i) ?? []) {
            if (s.type === "high") lastHigh = s.price;
            else lastLow = s.price;
          }
          const close = c[i].close;
          if (lastHigh !== null && close > lastHigh) {
            trend = "up";
            lastHigh = null;
          }
          if (lastLow !== null && close < lastLow) {
            trend = "down";
            lastLow = null;
          }
          const min = 0.3 * atr[i];
          if (c[i].low - c[i - 2].high > min) gaps.push({ side: "bull", bottom: c[i - 2].high, top: c[i].low, index: i });
          if (c[i - 2].low - c[i].high > min) gaps.push({ side: "bear", bottom: c[i].high, top: c[i - 2].low, index: i });
          gaps = gaps.filter(
            (g) => i - g.index <= 30 && (g.side === "bull" ? close >= g.bottom : close <= g.top)
          );
        },
        decide(i, pos) {
          const x = c[i];
          if (pos) {
            if (pos.side === "long" && trend === "down") return { type: "exit", reason: "Struktur snudde ned" };
            if (pos.side === "short" && trend === "up") return { type: "exit", reason: "Struktur snudde opp" };
            return null;
          }
          for (const g of gaps) {
            if (g.index >= i) continue;
            if (g.side === "bull" && trend === "up" && x.low <= g.top && x.close > g.top) {
              gaps = gaps.filter((o) => o !== g);
              const stop = g.bottom - 0.1 * atr[i];
              if (p.maxStopAtr && x.close - stop > p.maxStopAtr * atr[i]) continue;
              const reach = Math.min(2 * (x.close - stop), p.maxTargetAtr ? p.maxTargetAtr * atr[i] : Infinity);
              return { type: "enter", side: "long", stop, target: x.close + reach, reason: "Retest av bullish FVG" };
            }
            if (allowShort && g.side === "bear" && trend === "down" && x.high >= g.bottom && x.close < g.bottom) {
              gaps = gaps.filter((o) => o !== g);
              const stop = g.top + 0.1 * atr[i];
              if (p.maxStopAtr && stop - x.close > p.maxStopAtr * atr[i]) continue;
              const reach = Math.min(2 * (stop - x.close), p.maxTargetAtr ? p.maxTargetAtr * atr[i] : Infinity);
              return { type: "enter", side: "short", stop, target: x.close - reach, reason: "Retest av bearish FVG" };
            }
          }
          return null;
        }
      };
    }
  };
}
var fvgStructure = makeFvgStructure();
var ICT_DEFAULTS = {
  htfFactor: 4,
  swingN: 3,
  sweepWindow: 12,
  entryWindow: 24,
  displacementAtr: 1,
  minRR: 1.5,
  htfFilter: true,
  discount: true,
  fvgMinAtr: 0.2
};
var mirror = (c) => c.map((x) => ({ time: x.time, open: -x.open, high: -x.low, low: -x.high, close: -x.close }));
function htfBias(c, factor, n) {
  const sec = barSeconds(c);
  const span = sec * factor;
  const buckets = [];
  for (let i = 0; i < c.length; i++) {
    const start = Math.floor(c[i].time / span) * span;
    const b = buckets.at(-1);
    if (b && b.time === start) {
      b.high = Math.max(b.high, c[i].high);
      b.low = Math.min(b.low, c[i].low);
      b.close = c[i].close;
      b.last = i;
    } else buckets.push({ time: start, open: c[i].open, high: c[i].high, low: c[i].low, close: c[i].close, last: i });
  }
  const done = buckets.filter((b) => c[b.last].time + sec >= b.time + span);
  const sw = swings(done, n);
  const byConfirm = /* @__PURE__ */ new Map();
  for (const x of sw) byConfirm.set(x.confirmedAt, [...byConfirm.get(x.confirmedAt) ?? [], x]);
  const biasAt = [];
  let trend = 0;
  let hi = null;
  let lo = null;
  for (let k2 = 0; k2 < done.length; k2++) {
    for (const x of byConfirm.get(k2) ?? []) {
      if (x.type === "high") hi = x.price;
      else lo = x.price;
    }
    if (hi !== null && done[k2].close > hi) trend = 1;
    if (lo !== null && done[k2].close < lo) trend = -1;
    biasAt.push(trend);
  }
  const out = new Array(c.length).fill(0);
  let k = -1;
  for (let i = 0; i < c.length; i++) {
    while (k + 1 < done.length && done[k + 1].last <= i) k++;
    out[i] = k >= 0 ? biasAt[k] : 0;
  }
  return out;
}
function ictLongRunner(c, bias, p) {
  const atr = atrValues(c, 14);
  const byConfirm = /* @__PURE__ */ new Map();
  for (const x of swings(c, p.swingN)) byConfirm.set(x.confirmedAt, [...byConfirm.get(x.confirmedAt) ?? [], x]);
  let lows = [];
  let highs = [];
  let lastHigh = null;
  let sweep = null;
  let mss = null;
  let setup = null;
  return {
    update(i) {
      const x = c[i];
      for (const s of byConfirm.get(i) ?? []) {
        if (s.type === "low") lows.push(s);
        else {
          highs.push(s);
          lastHigh = s;
        }
      }
      const swept = lows.filter((l) => x.low < l.price);
      if (swept.length && x.close > Math.min(...swept.map((l) => l.price))) sweep = { low: x.low, index: i };
      else if (sweep && x.close < sweep.low) sweep = null;
      lows = lows.filter((l) => x.low >= l.price && i - l.index < 200);
      highs = highs.filter((h) => x.high <= h.price && i - h.index < 500);
      if (setup && (i - setup.armedAt > p.entryWindow || x.close < setup.fvgBottom)) setup = null;
      if (sweep && i - sweep.index > p.sweepWindow) sweep = null;
      if (sweep && lastHigh && i > sweep.index && x.close > lastHigh.price && x.close - x.open >= p.displacementAtr * atr[i]) {
        mss = { index: i, sweepLow: sweep.low, sweepIndex: sweep.index, atr: atr[i] };
        sweep = null;
      }
      if (mss) {
        let fvg = null;
        for (let k = Math.max(mss.sweepIndex + 1, 2); k <= i; k++)
          if (c[k].low - c[k - 2].high > p.fvgMinAtr * atr[k]) fvg = { top: c[k].low, bottom: c[k - 2].high };
        if (fvg) {
          let rangeHigh = -Infinity;
          for (let k = mss.sweepIndex; k <= i; k++) rangeHigh = Math.max(rangeHigh, c[k].high);
          const ce = (fvg.top + fvg.bottom) / 2;
          if (!p.discount || ce <= (mss.sweepLow + rangeHigh) / 2)
            setup = { ce, fvgBottom: fvg.bottom, stop: mss.sweepLow - 0.1 * mss.atr, rangeHigh, armedAt: i };
          mss = null;
        } else if (i - mss.index >= 2 || x.close < mss.sweepLow) mss = null;
      }
    },
    // Inngang når kursen er tilbake på 50 % av FVG-en og holder bunnen
    entry(i) {
      const x = c[i];
      if (!setup || i <= setup.armedAt || p.htfFilter && bias[i] !== 1) return null;
      if (!(x.low <= setup.ce && x.close >= setup.fvgBottom)) return null;
      const risk = x.close - setup.stop;
      if (risk <= 0) return null;
      const liquidity = highs.filter((h) => h.price >= x.close + p.minRR * risk).map((h) => h.price);
      if (!liquidity.length) return null;
      const s = setup;
      setup = null;
      return { stop: s.stop, target: Math.min(...liquidity) };
    }
  };
}
function makeIctModel(params = {}) {
  const p = { ...ICT_DEFAULTS, ...params };
  const isDefault = Object.entries(params).every(([k, v]) => ICT_DEFAULTS[k] === v);
  return {
    id: isDefault ? "ict-model" : `ict-model-${Object.values(p).join("-")}`,
    name: isDefault ? "ICT-modell (sweep \u2192 MSS \u2192 FVG)" : `ICT ${JSON.stringify(params)}`,
    interval: "1h",
    rules: [
      `Retning: struktur p\xE5 h\xF8yere tidsramme (${p.htfFactor} \xD7 dette intervallet)`,
      "Sweep: kursen stikker under en tidligere bunn og lukker tilbake over",
      `MSS: innen ${p.sweepWindow} lys bryter et kraftig lys (kropp \u2265 ${p.displacementAtr} \xD7 ATR) siste topp og etterlater en FVG`,
      "Inngang: tilbake p\xE5 50 % av FVG-en (i discount) og lukker over gapet",
      `Stop under sweepen. M\xE5l: n\xE6rmeste ur\xF8rte topp minst ${p.minRR}R unna. Short er speilvendt`
    ],
    warmup: 60,
    prepare(c, { allowShort }) {
      const bias = htfBias(c, p.htfFactor, p.swingN);
      const long = ictLongRunner(c, bias, p);
      const short = allowShort ? ictLongRunner(mirror(c), bias.map((b) => -b), p) : null;
      return {
        update(i) {
          long.update(i);
          short?.update(i);
        },
        decide(i, pos) {
          if (pos) {
            if (p.htfFilter && pos.side === "long" && bias[i] === -1) return { type: "exit", reason: "H\xF8yere tidsramme snudde ned" };
            if (p.htfFilter && pos.side === "short" && bias[i] === 1) return { type: "exit", reason: "H\xF8yere tidsramme snudde opp" };
            return null;
          }
          const l = long.entry(i);
          if (l) return { type: "enter", side: "long", stop: l.stop, target: l.target, reason: "Sweep \u2192 MSS \u2192 retest av FVG" };
          const s = short?.entry(i);
          if (s) return { type: "enter", side: "short", stop: -s.stop, target: -s.target, reason: "Sweep \u2192 MSS \u2192 retest av FVG (short)" };
          return null;
        }
      };
    }
  };
}
var ictModel = makeIctModel();
var rsiReversion = {
  id: "rsi-reversion",
  name: "RSI 30/70 med trendfilter",
  interval: "1h",
  rules: [
    "Kj\xF8p: RSI krysser opp over 30 og kursen er over SMA 200",
    "Short: RSI krysser ned under 70 og kursen er under SMA 200",
    "Exit: RSI tilbake til 55 (long) / 45 (short), eller stop p\xE5 2 \xD7 ATR"
  ],
  warmup: 200,
  prepare(c, { allowShort }) {
    const cl = closes(c);
    const r = rsiValues(cl, 14);
    const s200 = smaValues(cl, 200);
    const atr = atrValues(c, 14);
    return {
      decide(i, pos) {
        if (pos) {
          if (pos.side === "long" && r[i] >= 55) return { type: "exit", reason: "RSI n\xE5dde 55" };
          if (pos.side === "short" && r[i] <= 45) return { type: "exit", reason: "RSI n\xE5dde 45" };
          return null;
        }
        if (r[i - 1] < 30 && r[i] >= 30 && cl[i] > s200[i])
          return { type: "enter", side: "long", stop: cl[i] - 2 * atr[i], reason: "RSI opp over 30" };
        if (allowShort && r[i - 1] > 70 && r[i] <= 70 && cl[i] < s200[i])
          return { type: "enter", side: "short", stop: cl[i] + 2 * atr[i], reason: "RSI ned under 70" };
        return null;
      }
    };
  }
};
var STRATEGIES = [trendRegime, emaTrend, ictModel, fvgStructure, rsiReversion];

// src/sizing.ts
var SPOT_COSTS = { feePerSide: 15e-4, fundingPer8h: 0, mmr: 0 };
var FUTURES_COSTS = { feePerSide: 1e-3, fundingPer8h: 1e-4, mmr: 0.01 };
function liquidationPrice(side, entry, leverage, mmr) {
  if (side === "long") return leverage <= 1 ? 0 : entry * (1 - 1 / leverage) / (1 - mmr);
  return entry * (1 + 1 / leverage) / (1 + mmr);
}
function safeLeverage(entry, stop, mmr, buffer = 5e-3) {
  return 1 / (Math.abs(entry - stop) / entry + mmr + buffer);
}
var hasValidStop = (side, entry, stop) => stop !== void 0 && stop > 0 && (side === "long" ? stop < entry : stop > entry);
var stopBeforeLiq = (side, stop, liq) => side === "long" ? stop > liq : stop < liq;
function planPosition(side, equity, entry, stop, sizing, costs) {
  if (equity <= 0 || entry <= 0) return null;
  const validStop = hasValidStop(side, entry, stop);
  let notional;
  let leverage;
  if (sizing.mode === "fraction") {
    leverage = sizing.leverage;
    notional = equity * sizing.frac * leverage;
  } else if (sizing.mode === "risk" && validStop) {
    leverage = Math.max(1, Math.min(sizing.maxLeverage, safeLeverage(entry, stop, costs.mmr)));
    notional = Math.min(equity * sizing.riskPct * entry / Math.abs(entry - stop), equity * leverage);
  } else {
    leverage = 1;
    notional = equity / (1 + costs.feePerSide);
  }
  const qty = notional / entry;
  return {
    qty,
    notional,
    margin: notional / leverage,
    leverage,
    liq: liquidationPrice(side, entry, leverage, costs.mmr),
    riskUSD: validStop ? qty * Math.abs(entry - stop) : null,
    entryFee: notional * costs.feePerSide
  };
}

// src/backtest.ts
function maxDrawdown(curve) {
  let peak = -Infinity;
  let dd = 0;
  for (const v of curve) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, peak > 0 ? 1 - v / peak : 1);
  }
  return Math.min(dd, 1);
}
function backtest(c, strategy, opts) {
  const sizing = opts.sizing ?? { mode: "spot" };
  const costs = opts.costs ?? SPOT_COSTS;
  const fundingPerBar = costs.fundingPer8h * (barSeconds(c) / (8 * 3600));
  const runner = strategy.prepare(c, { allowShort: opts.allowShort });
  const trades = [];
  const equity = [];
  let cash = 1;
  let pos = null;
  let pending = [];
  let inMarket = 0;
  let ruined = false;
  const start = Math.min(warmupOf(strategy, c), c.length - 1);
  const sign2 = (s) => s === "long" ? 1 : -1;
  const unrealized = (p, price) => Math.max(-p.margin, sign2(p.side) * p.qty * (price - p.entry));
  const close = (i, price, reason, liquidated = false) => {
    if (!pos) return;
    const exitFee = liquidated ? 0 : pos.qty * price * costs.feePerSide;
    const gross = liquidated ? -pos.margin : sign2(pos.side) * pos.qty * (price - pos.entry);
    cash += gross - exitFee;
    const fees = pos.fees + exitFee;
    const pnl = gross - fees - pos.funding;
    trades.push({
      side: pos.side,
      entryIndex: pos.entryIndex,
      exitIndex: i,
      entry: pos.entry,
      exit: price,
      ret: pnl / pos.equityAtEntry,
      pnl,
      r: pos.riskUSD ? pnl / pos.riskUSD : null,
      leverage: pos.leverage,
      fees,
      funding: pos.funding,
      entryReason: pos.reason,
      exitReason: reason
    });
    pos = null;
    if (cash <= 1e-9) {
      cash = 0;
      ruined = true;
    }
  };
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    for (const a of pending) {
      if (a?.type === "exit") close(i, x.open, a.reason);
      if (a?.type === "enter" && !pos && !ruined) {
        const plan = planPosition(a.side, cash, x.open, a.stop, sizing, costs);
        if (plan && plan.qty > 0) {
          cash -= plan.entryFee;
          pos = {
            side: a.side,
            entryIndex: i,
            entry: x.open,
            stop: a.stop,
            target: a.target,
            reason: a.reason,
            qty: plan.qty,
            margin: plan.margin,
            liq: plan.liq,
            leverage: plan.leverage,
            riskUSD: plan.riskUSD,
            equityAtEntry: cash + plan.entryFee,
            fees: plan.entryFee,
            funding: 0
          };
        }
      }
    }
    pending = [];
    if (pos) {
      const p = pos;
      const long = p.side === "long";
      const hasLiq = long ? p.liq > 0 : Number.isFinite(p.liq);
      const hasStop = p.stop > 0;
      const liqHit = hasLiq && (long ? x.low <= p.liq : x.high >= p.liq);
      const stopHit = hasStop && (long ? x.low <= p.stop : x.high >= p.stop);
      const gapPastLiq = hasLiq && (long ? x.open <= p.liq : x.open >= p.liq);
      if (liqHit && (!hasStop || !stopBeforeLiq(p.side, p.stop, p.liq) || gapPastLiq)) {
        close(i, p.liq, "Likvidert", true);
      } else if (stopHit) {
        close(i, long ? Math.min(x.open, p.stop) : Math.max(x.open, p.stop), "Stop");
      } else if (p.target && (long ? x.high >= p.target : x.low <= p.target)) {
        close(i, long ? Math.max(x.open, p.target) : Math.min(x.open, p.target), "M\xE5l");
      }
    }
    if (pos && fundingPerBar) {
      const f = sign2(pos.side) * pos.qty * x.close * fundingPerBar;
      cash -= f;
      pos.funding += f;
    }
    if (i >= start && i >= 2 && !ruined) {
      runner.update?.(i);
      const a = runner.decide(i, pos);
      if (a?.type === "stop" && pos) pos.stop = a.stop;
      else if (a?.type === "exit" && pos) {
        pending.push(a);
        const next = runner.decide(i, null);
        if (next?.type === "enter") pending.push(next);
      } else if (a?.type === "enter") pending.push(a);
    }
    if (pos) inMarket++;
    equity.push(pos ? cash + unrealized(pos, x.close) : cash);
  }
  const curve = equity.slice(start);
  const bhCurve = c.slice(start).map((x) => x.close);
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  let streak = 0;
  let longest = 0;
  for (const t of trades) {
    streak = t.pnl <= 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const final = equity.at(-1) ?? 1;
  const days = c.length > start ? (c.at(-1).time - c[start].time) / 86400 : 0;
  const cagr = days > 0 && final > 0 ? final ** (365 / days) - 1 : final > 0 ? 0 : -1;
  const dd = maxDrawdown(curve);
  const rs = trades.flatMap((t) => t.r === null ? [] : [t.r]);
  return {
    trades,
    open: pos,
    pending,
    equity,
    start,
    totalReturn: final - 1,
    buyHold: c.length > start ? c.at(-1).close / c[start].open * (1 - SPOT_COSTS.feePerSide) ** 2 - 1 : 0,
    maxDrawdown: dd,
    buyHoldDrawdown: maxDrawdown(bhCurve),
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss === 0 ? grossWin > 0 ? Infinity : 0 : grossWin / grossLoss,
    avgTrade: trades.length ? trades.reduce((s, t) => s + t.ret, 0) / trades.length : 0,
    exposure: c.length > start ? inMarket / (c.length - start) : 0,
    cagr,
    calmar: dd > 0 ? cagr / dd : 0,
    longestLosingStreak: longest,
    liquidations: trades.filter((t) => t.exitReason === "Likvidert").length,
    totalFees: trades.reduce((s, t) => s + t.fees, 0) + (pos ? pos.fees : 0),
    totalFunding: trades.reduce((s, t) => s + t.funding, 0) + (pos ? pos.funding : 0),
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    ruined
  };
}

// src/coins.ts
var COINS = [
  { symbol: "BTCUSDT", name: "Bitcoin", ticker: "BTC", tick: 0.1, step: 1e-3, minNotional: 50 },
  { symbol: "ETHUSDT", name: "Ethereum", ticker: "ETH", tick: 0.01, step: 1e-3, minNotional: 20 },
  { symbol: "SOLUSDT", name: "Solana", ticker: "SOL", tick: 0.01, step: 0.01, minNotional: 5 },
  { symbol: "AAVEUSDT", name: "Aave", ticker: "AAVE", tick: 0.01, step: 0.1, minNotional: 5 },
  { symbol: "AVAXUSDT", name: "Avalanche", ticker: "AVAX", tick: 1e-3, step: 1, minNotional: 5 }
];
var coinBySymbol = (symbol) => COINS.find((c) => c.symbol === symbol);
function roundStep(value, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return +(Math.floor(value / step + 1e-9) * step).toFixed(decimals);
}

// src/paper/engine.ts
var TAKER_FEE = 5e-4;
var SLIPPAGE = 5e-4;
var MMR = FUTURES_COSTS.mmr;
var sign = (s) => s === "long" ? 1 : -1;
var fillPrice = (side, mark, opening) => mark * (1 + sign(side) * (opening ? 1 : -1) * SLIPPAGE);
function buildOpenPayload(input, now = Date.now()) {
  const coin = coinBySymbol(input.symbol);
  const qty = coin ? roundStep(input.qty, coin.step) : input.qty;
  const entry = fillPrice(input.side, input.mark, true);
  const notional = qty * entry;
  return {
    symbol: input.symbol,
    side: input.side,
    qty,
    entry,
    leverage: input.leverage,
    margin: notional / input.leverage,
    liq: liquidationPrice(input.side, entry, input.leverage, MMR),
    stop: input.stop ?? null,
    target: input.target ?? null,
    trail_atr_mult: input.trail?.atrMult ?? null,
    opened_at: now,
    fees: notional * TAKER_FEE,
    risk_usd: input.stop ? qty * Math.abs(entry - input.stop) : null,
    strategy_id: input.strategyId ?? null,
    signal_id: input.signalId ?? null
  };
}

// src/bot.ts
function botStep(bot, candles, hasPosition, balance, free, mark, now) {
  const strategy = STRATEGIES.find((s) => s.id === bot.strategy_id);
  if (!strategy) return { exit: null, open: null, note: `Ukjent strategi ${bot.strategy_id}` };
  const r = backtest(candles, strategy, { allowShort: bot.allow_short });
  const exit = r.pending.find((a) => a?.type === "exit");
  const enter = r.pending.find((a) => a?.type === "enter");
  const step = { exit: exit?.type === "exit" && hasPosition ? exit.reason : null, open: null, note: null };
  if (enter?.type !== "enter" || hasPosition && !step.exit) return step;
  const coin = coinBySymbol(bot.symbol);
  const entry = fillPrice(enter.side, mark, true);
  const stop = enter.stop > 0 ? enter.stop : void 0;
  if (stop !== void 0 && (enter.side === "long" ? stop >= entry : stop <= entry)) {
    step.note = `Signal ${enter.side}, men kursen har allerede passert stopen`;
    return step;
  }
  const plan = planPosition(
    enter.side,
    balance,
    entry,
    stop,
    { mode: "risk", riskPct: bot.risk_pct, maxLeverage: bot.max_leverage },
    FUTURES_COSTS
  );
  if (!plan) return { ...step, note: "Kunne ikke regne ut st\xF8rrelse" };
  const leverage = Math.max(1, Math.floor(plan.leverage));
  const maxNotional = Math.min(free, balance) * leverage * 0.98;
  let qty = Math.min(plan.qty, maxNotional / entry);
  if (coin) qty = roundStep(qty, coin.step);
  if (!(qty > 0) || coin && qty * entry < coin.minNotional) {
    step.note = `Signal ${enter.side}, men for lite ledig margin`;
    return step;
  }
  step.open = buildOpenPayload(
    {
      symbol: bot.symbol,
      side: enter.side,
      qty,
      leverage,
      mark,
      stop,
      target: enter.target,
      trail: stop && strategy.trailAtr ? { atrMult: strategy.trailAtr } : void 0,
      strategyId: strategy.id,
      signalId: `${bot.id}|${candles.at(-1).time}`
    },
    now
  );
  step.note = enter.reason;
  return step;
}
export {
  botStep
};
