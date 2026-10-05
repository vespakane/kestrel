(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  const LS_HOLDINGS = 'kestrel.holdings';
  const LS_MARKET = 'kestrel.market';

  // Tokens priced from Hyperliquid marks. Optional ones only get a row once they are held.
  const PRICED = [
    { id: 'sol', sym: 'SOL' },
    { id: 'btc', sym: 'BTC', optional: true },
    { id: 'eth', sym: 'ETH', optional: true },
    { id: 'zec', sym: 'ZEC', optional: true },
    { id: 'hype', sym: 'HYPE', optional: true },
  ];
  const HOLDING_IDS = [...PRICED.map((t) => t.id), 'usdc', 'cash'];

  const DEFAULT_HOLDINGS = { sol: 0.04843, btc: 0, eth: 0, zec: 0, hype: 0, usdc: 3.65476, cash: 2 };
  // Seed values so the first paint matches the screenshot before any fetch resolves.
  const DEFAULT_MARKET = {
    sol: { price: 117.28, pct: 0.18 },
    btc: { price: 83889, pct: -0.52 },
    eth: { price: 2693.2, pct: -0.36 },
    zec: { price: 1389.9, pct: -5.4 },
    hype: { price: 89.08, pct: 3.55 },
    usdcSign: -1,           // USDC is pegged 1:1; only the direction of its tiny daily move is shown
    perps: { BTC: -0.25, ETH: -0.53, ZEC: 7.95, HYPE: 0.26, CL: -0.15 },
    updated: 0,
  };

  const load = (key, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v && typeof v === 'object' ? { ...fallback, ...v } : { ...fallback };
    } catch { return { ...fallback }; }
  };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

  let holdings = load(LS_HOLDINGS, DEFAULT_HOLDINGS);
  let market = load(LS_MARKET, DEFAULT_MARKET);
  market.perps = { ...DEFAULT_MARKET.perps, ...(market.perps || {}) };
  delete market.usdc;
  if (market.usdcSign !== 1 && market.usdcSign !== -1) market.usdcSign = -1;

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */
  const sign = (v) => (v < 0 ? '-' : '+');
  const money = (v) => '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Portfolio change: the original shows extra precision under a dollar (e.g. +$0.0106).
  const totalChangeText = (v) => {
    const a = Math.abs(v);
    if (a === 0) return '$0.00';
    if (a >= 1) return sign(v) + money(a);
    let s = a.toFixed(4).replace(/0+$/, '');
    if (s.split('.')[1].length < 2) s = a.toFixed(2);
    return sign(v) + '$' + s;
  };
  // Per-token change: rounds to cents, "<$0.01" below half a cent.
  const tokenChangeText = (v) => {
    const a = Math.abs(v);
    if (a === 0) return '$0.00';
    if (a < 0.005) return sign(v) + '<$0.01';
    return sign(v) + money(a);
  };
  const pctText = (p) => (p === 0 ? '0.00%' : sign(p) + money(p).slice(1) + '%');
  const qtyText = (q) => q.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 5 });
  const setSigned = (el, text, v) => {
    el.textContent = text;
    el.classList.toggle('pos', v > 0);
    el.classList.toggle('neg', v < 0);
    el.classList.toggle('flat', v === 0);
  };

  /* ------------------------------------------------------------------ */
  /* Portfolio maths                                                     */
  /* ------------------------------------------------------------------ */
  const tokenValue = (qty, { price, pct }) => {
    const value = qty * price;
    const prevPrice = price / (1 + pct / 100);
    return { value, change: qty * (price - prevPrice) };
  };

  const compute = () => {
    const tokens = { usdc: { value: holdings.usdc, change: 0 } };   // 1 USDC = 1 USD
    let total = holdings.cash + holdings.usdc;
    let change = 0;
    for (const { id } of PRICED) {
      tokens[id] = tokenValue(holdings[id], market[id]);
      total += tokens[id].value;
      change += tokens[id].change;
    }
    const base = total - change;
    const pct = base > 0 ? (change / base) * 100 : 0;
    return { tokens, total, change, pct };
  };

  const tokenRow = (id) => document.querySelector('.token[data-token="' + id + '"]');

  const render = () => {
    const p = compute();
    $('totalUsd').textContent = money(p.total);
    setSigned($('totalChange'), totalChangeText(p.change), p.change);
    setSigned($('totalPct'), pctText(p.pct), p.change);
    $('cashUsd').textContent = money(holdings.cash);

    for (const { id, sym, optional } of PRICED) {
      const t = p.tokens[id];
      $(id + 'Qty').textContent = qtyText(holdings[id]) + ' ' + sym;
      $(id + 'Usd').textContent = money(t.value);
      setSigned($(id + 'Change'), tokenChangeText(t.change), t.change);
      if (optional) tokenRow(id).hidden = !(holdings[id] > 0);
    }

    $('usdcQty').textContent = qtyText(holdings.usdc) + ' USDC';
    $('usdcUsd').textContent = money(p.tokens.usdc.value);
    setSigned($('usdcChange'), (market.usdcSign < 0 ? '-' : '+') + '<$0.01', market.usdcSign < 0 ? -1 : 1);

    // Largest holding first, like the original.
    Object.keys(p.tokens)
      .sort((a, b) => p.tokens[b].value - p.tokens[a].value)
      .forEach((id, i) => { tokenRow(id).style.order = i; });

    document.querySelectorAll('.perp[data-perp]').forEach((card) => {
      const pct = market.perps[card.dataset.perp];
      if (typeof pct !== 'number' || Number.isNaN(pct)) return;
      setSigned(card.querySelector('[data-pct]'), pctText(pct), pct);
    });

    if ($('send').classList.contains('open')) renderSend();
  };

  /* ------------------------------------------------------------------ */
  /* Market data                                                         */
  /* ------------------------------------------------------------------ */
  const HL = 'https://api.hyperliquid.xyz/info';
  const CG = 'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd&include_24hr_change=true';

  const hlChanges = async (dex) => {
    const body = dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' };
    const res = await fetch(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HL ' + res.status);
    const [meta, ctxs] = await res.json();
    const out = {};
    meta.universe.forEach((asset, i) => {
      const ctx = ctxs[i];
      if (!ctx) return;
      const mark = parseFloat(ctx.markPx);
      const prev = parseFloat(ctx.prevDayPx);
      if (mark > 0 && prev > 0) out[asset.name] = { price: mark, pct: (mark / prev - 1) * 100 };
    });
    return out;
  };

  const refreshMarket = async () => {
    const [main, xyz] = await Promise.allSettled([hlChanges(), hlChanges('xyz')]);
    let changed = false;

    if (main.status === 'fulfilled') {
      for (const sym of ['BTC', 'ETH', 'ZEC', 'HYPE']) {
        if (main.value[sym]) { market.perps[sym] = main.value[sym].pct; changed = true; }
      }
      for (const { id, sym } of PRICED) {
        if (main.value[sym]) { market[id] = { price: main.value[sym].price, pct: main.value[sym].pct }; changed = true; }
      }
    }
    if (xyz.status === 'fulfilled' && xyz.value['xyz:CL']) {
      market.perps.CL = xyz.value['xyz:CL'].pct; changed = true;
    }
    if (changed) {
      market.updated = Date.now();
      save(LS_MARKET, market);
      render();
    }
  };

  // Only the direction of USDC's daily move is needed; CoinGecko once a minute is plenty.
  const refreshUsdcSign = async () => {
    try {
      const r = await fetch(CG);
      if (!r.ok) return;
      const g = await r.json();
      const chg = g['usd-coin'] && g['usd-coin'].usd_24h_change;
      if (typeof chg === 'number' && chg !== 0) {
        market.usdcSign = chg < 0 ? -1 : 1;
        save(LS_MARKET, market);
        render();
      }
    } catch { /* keep last known direction */ }
  };

  /* ------------------------------------------------------------------ */
  /* Clock                                                               */
  /* ------------------------------------------------------------------ */
  const tickClock = () => {
    const d = new Date();
    $('statusTime').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  /* ------------------------------------------------------------------ */
  /* Drawer                                                              */
  /* ------------------------------------------------------------------ */
  const phone = $('phone');
  const openDrawer = () => phone.classList.add('drawer-open');
  const closeDrawer = () => phone.classList.remove('drawer-open');
  $('avatarBtn').addEventListener('click', openDrawer);
  $('pageDim').addEventListener('click', closeDrawer);

  // Swipe left on the pushed page closes the drawer; swipe right from the left edge opens it.
  let touchX = null, touchY = null, edgeSwipe = false;
  phone.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchX = t.clientX; touchY = t.clientY;
    edgeSwipe = !phone.classList.contains('drawer-open') && t.clientX - phone.getBoundingClientRect().left < 24;
  }, { passive: true });
  phone.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX, dy = t.clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && phone.classList.contains('drawer-open')) closeDrawer();
      if (dx > 0 && edgeSwipe) openDrawer();
    }
    touchX = touchY = null;
  }, { passive: true });

  /* ------------------------------------------------------------------ */
  /* Plus actions                                                        */
  /* ------------------------------------------------------------------ */
  const actions = $('actions');
  $('fab').addEventListener('click', () => actions.classList.add('open'));
  $('actionsClose').addEventListener('click', () => actions.classList.remove('open'));
  actions.addEventListener('click', (e) => { if (e.target === actions) actions.classList.remove('open'); });
  actions.querySelectorAll('.action').forEach((b) => b.addEventListener('click', () => actions.classList.remove('open')));

  /* ------------------------------------------------------------------ */
  /* Send flow                                                           */
  /* ------------------------------------------------------------------ */
  const LS_RECENTS = 'kestrel.recents';
  const SENDABLE = {
    cash: { sym: 'Cash', icon: 'assets/cash.png' },
    sol: { sym: 'SOL', icon: 'assets/sol.png' },
    usdc: { sym: 'USDC', icon: 'assets/usdc.png' },
    btc: { sym: 'BTC', icon: 'assets/btc.png' },
    eth: { sym: 'ETH', icon: 'assets/eth.png' },
    zec: { sym: 'ZEC', icon: 'assets/zec.png' },
    hype: { sym: 'HYPE', icon: 'assets/hype.png' },
  };
  const priceOf = (id) => (market[id] && market[id].price) || 1;   // cash and USDC are dollars
  // Everything with a balance, largest first.
  const balances = () => Object.keys(SENDABLE)
    .map((id) => ({ id, usd: (holdings[id] || 0) * priceOf(id) }))
    .filter((b) => b.usd > 0)
    .sort((a, b) => b.usd - a.usd);

  let recents = [];
  try { const r = JSON.parse(localStorage.getItem(LS_RECENTS)); if (Array.isArray(r)) recents = r.filter((x) => typeof x === 'string'); } catch { /* none */ }

  // Which network an address belongs to (only used for its icon and the fee's output size).
  const B58 = '[1-9A-HJ-NP-Za-km-z]';
  const ADDRESS_KINDS = [
    ['user', /^@\w{2,30}$/],
    ['eth', /^0x[0-9a-fA-F]{40}$/],
    ['btc', new RegExp('^(bc1[02-9ac-hj-np-z]{11,87}|[13]' + B58 + '{25,34})$')],
    ['zec', new RegExp('^(t[13]' + B58 + '{33}|zs1[0-9a-z]{60,}|u1[0-9a-z]{60,})$')],
    ['sol', new RegExp('^' + B58 + '{32,44}$')],
  ];
  const addressKind = (s) => { const k = ADDRESS_KINDS.find(([, re]) => re.test(s)); return k ? k[0] : null; };
  const shortAddr = (a, n) => (a[0] === '@' || a.length <= n * 2 + 3 ? a : a.slice(0, n) + '...' + a.slice(-n));

  const sendEl = $('send'), rcpInput = $('rcpInput'), toast = $('toast');
  const STEPS = ['to', 'amount', 'review'];
  const tx = { to: '', token: 'sol', amt: '', max: false, step: 'to', seed: [0, 0] };

  /* Network fees. Each token pays its own chain's fee, sized like a real transfer:
     SOL   5,000 lamports per signature + a priority fee
     USDC  the same in SOL, plus 0.00203928 SOL rent for the recipient's token account on a first send
     BTC   virtual size (inputs + outputs, by address type) x the current sat/vB rate
     ETH / HYPE   21,000 gas x the chain's current gas price
     ZEC   ZIP-317: 5,000 zatoshi per logical action, minimum two
     Cash  free
     Live rates come from public endpoints; until they answer, a typical value is used. */
  const netFees = {};
  const rpcGasGwei = async (url) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) });
    const g = parseInt((await r.json()).result, 16) / 1e9;
    if (!(g > 0)) throw new Error('gas');
    return g;
  };
  const refreshFees = () => {
    const done = () => { if (sendEl.classList.contains('open')) renderSend(); };
    fetch('https://mempool.space/api/v1/fees/recommended').then((r) => r.json()).then((j) => { if (j.halfHourFee > 0) { netFees.btc = j.halfHourFee; done(); } }).catch(() => {});
    rpcGasGwei('https://ethereum-rpc.publicnode.com').then((g) => { netFees.eth = g; done(); }).catch(() => {});
    rpcGasGwei('https://rpc.hyperliquid.xyz/evm').then((g) => { netFees.hype = g; done(); }).catch(() => {});
  };
  // tx.seed keeps the varying part steady while one send is on screen.
  const vary = (lo, hi, i = 0) => lo + tx.seed[i] * (hi - lo);
  const quoteFee = (id, usd, haveUsd) => {
    const kind = addressKind(tx.to);
    let token = id, qty = 0;
    if (id === 'sol' || id === 'usdc') {
      token = 'sol';
      let lamports = 5000 + Math.round(id === 'sol' ? vary(60000, 92000) : vary(75000, 120000));
      if (id === 'usdc' && !recents.includes(tx.to)) lamports += 2039280;
      qty = lamports / 1e9;
      // No SOL to pay with: the fee comes out of the USDC instead.
      if (id === 'usdc' && (holdings.sol || 0) < qty) { token = 'usdc'; qty *= priceOf('sol'); }
    } else if (id === 'btc') {
      const rate = netFees.btc || Math.round(vary(2, 7));
      const inputs = !tx.max && usd > haveUsd / 2 ? 2 : 1;
      const out = /^bc1p/.test(tx.to) ? 43 : /^bc1/.test(tx.to) ? 31 : /^3/.test(tx.to) ? 32 : kind === 'btc' ? 34 : 31;
      const vsize = 10.5 + 68 * inputs + out + (tx.max ? 0 : 31);   // change output unless sending everything
      qty = Math.ceil(vsize * rate) / 1e8;
    } else if (id === 'eth') {
      qty = 21000 * (netFees.eth || vary(0.6, 2.5)) / 1e9;
    } else if (id === 'hype') {
      qty = 21000 * (netFees.hype || vary(0.1, 0.5)) / 1e9;
    } else if (id === 'zec') {
      qty = 5000 * (/^(zs1|u1)/.test(tx.to) ? 4 : 2) / 1e8;
    }
    return { token, qty, usd: qty * priceOf(token) };
  };
  const feeText = (usd) => {
    if (!(usd > 0)) return 'No fee';
    if (usd >= 0.01) return '$' + usd.toFixed(2) + ' fee';
    if (usd < 0.000001) return '<$0.000001 fee';
    return '$' + usd.toFixed(1 - Math.floor(Math.log10(usd))) + ' fee';   // two significant digits
  };

  // What the current entry would move: token quantity, fee, and whether the balance covers both.
  const plan = () => {
    const id = tx.token, price = priceOf(id), have = holdings[id] || 0;
    const usd = parseFloat(tx.amt) || 0;
    const fee = quoteFee(id, usd, have * price);
    const feeSame = fee.token === id ? fee.qty : 0;
    const qty = tx.max ? Math.max(0, have - feeSame) : usd / price;
    const ok = usd > 0 && qty > 0 && qty + feeSame <= have * (1 + 1e-9) && (feeSame > 0 || fee.qty <= (holdings[fee.token] || 0));
    return { id, usd, qty, fee, ok };
  };
  const sendQtyText = (id, qty) => {
    if (id === 'cash') return money(qty);
    const n = qty >= 1 ? qty.toLocaleString('en-US', { maximumFractionDigits: 4 }) : Number(qty.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 10 });
    return n + ' ' + SENDABLE[id].sym;
  };
  const amountText = () => {
    const [int, dec] = (tx.amt || '0').split('.');
    return '$' + Number(int || 0).toLocaleString('en-US') + (dec === undefined ? '' : '.' + dec);
  };
  const fitAmount = (el, text) => {
    el.textContent = text;
    el.style.fontSize = Math.min(112, Math.floor(346 / (0.58 * text.length))) + 'px';
  };

  const renderSend = () => {
    const p = plan();
    const has = p.usd > 0;
    $('amtTo').textContent = shortAddr(tx.to, 5);
    fitAmount($('amtDisplay'), amountText());
    $('amtDisplay').classList.toggle('has', has);
    $('amtSym').textContent = SENDABLE[tx.token].sym;
    $('amtBal').textContent = money((holdings[tx.token] || 0) * priceOf(tx.token));
    $('amtCta').classList.toggle('review', has);
    $('amtReview').textContent = !has || p.ok ? 'Review' : 'Insufficient balance';
    $('amtReview').classList.toggle('off', has && !p.ok);

    fitAmount($('rvAmount'), amountText());
    $('rvTo').textContent = shortAddr(tx.to, 5);
    $('rvSym').textContent = SENDABLE[tx.token].sym;
    $('rvFee').textContent = feeText(p.fee.usd);
    $('rvQty').textContent = sendQtyText(tx.token, p.qty);
    if (tx.step === 'review' && !p.ok) setStep('amount');
    if (sendEl.classList.contains('method-open')) openMethod();   // keep the listed balances live
  };

  const setStep = (step) => {
    tx.step = step;
    const at = STEPS.indexOf(step);
    sendEl.querySelectorAll('.send-step').forEach((el) => {
      const i = STEPS.indexOf(el.dataset.step);
      el.classList.toggle('on', i === at);
      el.classList.toggle('past', i < at);
    });
    sendEl.classList.remove('method-open');
    if (step !== 'to') rcpInput.blur();
  };

  const rcpRow = (addr) => {
    const kind = addressKind(addr);
    const b = document.createElement('button');
    b.className = 'rcp';
    const ic = document.createElement('span');
    ic.className = 'rcp-ic';
    if (kind === 'user' || !kind) ic.textContent = '@';
    else { const img = document.createElement('img'); img.src = SENDABLE[kind].icon; img.alt = ''; ic.appendChild(img); }
    const t = document.createElement('span');
    t.className = 'rcp-addr';
    t.textContent = shortAddr(addr, 10);
    b.append(ic, t);
    b.addEventListener('click', () => chooseRecipient(addr));
    return b;
  };
  const renderRecipients = () => {
    const q = rcpInput.value.trim();
    const typed = q && addressKind(q) && !recents.includes(q) ? [q] : [];
    const shown = typed.concat(recents.filter((a) => !q || a.toLowerCase().includes(q.toLowerCase())));
    $('rcpLabel').textContent = q ? 'Send to' : 'Recents';
    $('rcpLabel').hidden = !shown.length;
    $('rcpList').replaceChildren(...shown.map(rcpRow));
    return shown;
  };
  const chooseRecipient = (addr) => {
    tx.to = addr;
    renderSend();
    setStep('amount');
  };

  const openSend = () => {
    const top = balances()[0];
    Object.assign(tx, { to: '', token: top ? top.id : 'sol', amt: '', max: false, seed: [Math.random(), Math.random()] });
    rcpInput.value = '';
    renderRecipients();
    setStep('to');
    sendEl.classList.add('open');
    refreshFees();
  };
  const closeSend = () => { sendEl.classList.remove('open', 'method-open'); rcpInput.blur(); };

  $('actSend').addEventListener('click', openSend);
  $('sendClose').addEventListener('click', closeSend);
  $('amtBack').addEventListener('click', () => { renderRecipients(); setStep('to'); });
  $('rvBack').addEventListener('click', () => setStep('amount'));
  $('rvToRow').addEventListener('click', () => { renderRecipients(); setStep('to'); });
  rcpInput.addEventListener('input', renderRecipients);
  rcpInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const shown = renderRecipients();
    if (shown.length) chooseRecipient(shown[0]);
  });
  $('rcpPaste').addEventListener('click', async (e) => {
    e.preventDefault();
    try { rcpInput.value = (await navigator.clipboard.readText()).trim(); renderRecipients(); goIfAddress(); } catch { rcpInput.focus(); }
  });
  // A pasted address is complete, so it goes straight on to the amount.
  const goIfAddress = () => {
    const q = rcpInput.value.trim(), kind = addressKind(q);
    if (kind && kind !== 'user') chooseRecipient(q);
  };
  rcpInput.addEventListener('paste', () => setTimeout(() => { renderRecipients(); goIfAddress(); }, 0));

  // Keypad: dollars with up to two decimals.
  const pressKey = (k) => {
    let a = tx.amt;
    if (k === 'back') a = a.slice(0, -1);
    else if (k === '.') { if (!a.includes('.')) a = (a || '0') + '.'; }
    else if (a === '0') a = k;
    else if (!(a.includes('.') ? a.split('.')[1].length >= 2 : a.length >= 9)) a += k;
    tx.amt = a === '0' && k === 'back' ? '' : a;
    tx.max = false;
    renderSend();
  };
  $('keypad').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) pressKey(b.dataset.k); });
  document.querySelectorAll('.pcts [data-pct]').forEach((b) => b.addEventListener('click', () => {
    const pct = +b.dataset.pct, id = tx.token, have = holdings[id] || 0;
    tx.max = pct === 100;
    tx.amt = '';
    // 100% sends everything left once the fee is covered.
    const fee = quoteFee(id, have * priceOf(id), have * priceOf(id));
    const spendable = tx.max ? Math.max(0, have - (fee.token === id ? fee.qty : 0)) : have * pct / 100;
    const usd = Math.floor(spendable * priceOf(id) * 100 + 1e-6) / 100;
    tx.amt = usd > 0 ? String(usd) : '';
    if (!tx.amt) tx.max = false;
    renderSend();
  }));
  $('amtReview').addEventListener('click', () => { if (plan().ok) setStep('review'); });

  // Payment method sheet
  const openMethod = () => {
    const list = balances();
    const rows = list.map(({ id, usd }) => {
      const b = document.createElement('button');
      b.className = 'method-row';
      b.innerHTML = '<span class="method-ic' + (id === 'cash' ? ' cash' : '') + '"><img src="' + (id === 'cash' ? 'assets/ghost.png' : SENDABLE[id].icon) + '" alt=""></span>' +
        '<span class="method-name">' + SENDABLE[id].sym + '<small>' + money(usd) + '</small></span>' +
        (id === tx.token ? '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1.5 9.5 L5.5 14 L14.5 1.5" fill="none" stroke="#ab9ff2" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '');
      b.addEventListener('click', () => {
        if (id !== tx.token) { tx.token = id; tx.amt = tx.step === 'review' ? tx.amt : ''; tx.max = false; }
        sendEl.classList.remove('method-open');
        renderSend();
      });
      return b;
    });
    if (!rows.length) { const e = document.createElement('div'); e.className = 'method-empty'; e.textContent = 'No balances to send'; rows.push(e); }
    $('methodList').replaceChildren(...rows);
    sendEl.classList.add('method-open');
  };
  $('amtToken').addEventListener('click', openMethod);
  $('rvPayRow').addEventListener('click', openMethod);
  $('methodClose').addEventListener('click', () => sendEl.classList.remove('method-open'));
  $('methodBackdrop').addEventListener('click', () => sendEl.classList.remove('method-open'));

  // Confirm: back to home, "Sending..." toast, then the balance drops and the toast turns green.
  let toastTimers = [];
  const confirmSend = () => {
    const p = plan();
    if (!p.ok) return;
    const all = tx.max, to = tx.to;
    closeSend();
    toastTimers.forEach(clearTimeout);
    toast.classList.remove('done', 'swap');
    toast.style.width = '';
    $('toastText').textContent = 'Sending...';
    toast.classList.add('show');
    const take = (id, qty) => {
      const left = (holdings[id] || 0) - qty;
      holdings[id] = left > 1e-9 ? +left.toFixed(id === 'cash' ? 2 : 9) : 0;
    };
    toastTimers = [
      setTimeout(() => {
        const from = { ...holdings };
        take(p.id, p.qty);
        if (p.fee.qty > 0) take(p.fee.token, p.fee.qty);
        if (all) holdings[p.id] = 0;
        const after = { ...holdings };
        save(LS_HOLDINGS, after);
        recents = [to].concat(recents.filter((a) => a !== to)).slice(0, 12);
        try { localStorage.setItem(LS_RECENTS, JSON.stringify(recents)); } catch { /* private mode */ }

        // The toast eases to its new width while the label cross-fades and the tick draws in.
        const w0 = toast.offsetWidth;
        toast.style.width = w0 + 'px';
        toast.classList.add('swap');
        toastTimers.push(setTimeout(() => {
          $('toastText').textContent = 'Sent ' + money(p.usd);
          toast.classList.add('done');
          toast.style.width = '';
          const w1 = toast.offsetWidth;
          toast.style.width = w0 + 'px';
          toast.offsetWidth;   // flush so the width animates from the old size
          toast.style.width = w1 + 'px';
          toast.classList.remove('swap');
        }, 160));

        // Balances count down to their new values instead of jumping.
        const t0 = performance.now(), DUR = 900;
        const tick = (now) => {
          const k = Math.min(1, (now - t0) / DUR), e = 1 - Math.pow(1 - k, 3);
          for (const id of HOLDING_IDS) holdings[id] = k === 1 ? after[id] : from[id] + (after[id] - from[id]) * e;
          render();
          if (k < 1) requestAnimationFrame(tick);
        };
        toastTimers.push(setTimeout(() => requestAnimationFrame(tick), 220));
      }, 1900),
      setTimeout(() => toast.classList.remove('show'), 5000),
    ];
  };
  $('rvConfirm').addEventListener('click', confirmSend);

  /* ------------------------------------------------------------------ */
  /* Edit holdings sheet                                                 */
  /* ------------------------------------------------------------------ */
  // Inputs are #inSol, #inBtc, ... with a matching #inSolUsd preview under each.
  const inId = (id) => 'in' + id[0].toUpperCase() + id.slice(1);
  const inputs = Object.fromEntries(HOLDING_IDS.map((id) => [id, $(inId(id))]));
  const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/,/g, '.').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const previewSheet = () => {
    let total = 0;
    for (const id of HOLDING_IDS) {
      const qty = parseNum(inputs[id].value);
      const usd = market[id] && id !== 'usdc' ? tokenValue(qty, market[id]).value : qty;
      $(inId(id) + 'Usd').textContent = money(usd);
      total += usd;
    }
    $('inTotal').textContent = money(total);
  };
  const openSheet = (focus) => {
    for (const id of HOLDING_IDS) inputs[id].value = id === 'cash' ? holdings.cash.toFixed(2) : qtyText(holdings[id]);
    previewSheet();
    phone.classList.add('sheet-open');
    const el = inputs[focus];
    if (el) setTimeout(() => { el.focus(); el.select(); }, 420);
  };
  const closeSheet = () => { phone.classList.remove('sheet-open'); document.activeElement && document.activeElement.blur(); };

  $('cashCard').addEventListener('click', () => openSheet('cash'));
  document.querySelectorAll('.token[data-token]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.token)));
  Object.values(inputs).forEach((i) => i.addEventListener('input', previewSheet));
  $('sheetSave').addEventListener('click', () => {
    holdings = Object.fromEntries(HOLDING_IDS.map((id) => [id, parseNum(inputs[id].value)]));
    save(LS_HOLDINGS, holdings);
    render();
    closeSheet();
  });
  $('sheetCancel').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); closeDrawer(); actions.classList.remove('open'); closeSend(); }
    if (sendEl.classList.contains('open') && tx.step === 'amount' && !sendEl.classList.contains('method-open')) {
      if (/^[0-9.]$/.test(e.key)) pressKey(e.key);
      if (e.key === 'Backspace') pressKey('back');
      if (e.key === 'Enter') $('amtReview').click();
    }
    if (e.key === 'Enter' && phone.classList.contains('sheet-open')) $('sheetSave').click();
  });

  /* ------------------------------------------------------------------ */
  /* Tabs (visual only)                                                  */
  /* ------------------------------------------------------------------ */
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
  }));

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  render();
  tickClock();
  setInterval(tickClock, 1000);
  refreshMarket();
  refreshUsdcSign();
  setInterval(refreshMarket, 12000);
  setInterval(refreshUsdcSign, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshMarket(); refreshUsdcSign(); } });

  // Diagnostics: tap the Bank row 5 times quickly to see viewport metrics on-device.
  let bankTaps = [];
  document.querySelector('.bank-row').addEventListener('click', () => {
    const now = Date.now();
    bankTaps = bankTaps.filter((t) => now - t < 2000).concat(now);
    if (bankTaps.length < 5) return;
    bankTaps = [];
    let box = document.querySelector('.diag');
    if (!box) {
      box = document.createElement('div');
      box.className = 'diag';
      box.addEventListener('click', () => box.classList.remove('show'));
      phone.appendChild(box);
    }
    const cs = getComputedStyle(phone);
    const vv = window.visualViewport;
    const pb = phone.getBoundingClientRect();
    box.textContent = [
      'standalone: ' + (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true),
      'inner:      ' + innerWidth + ' x ' + innerHeight,
      'screen:     ' + screen.width + ' x ' + screen.height,
      'visual:     ' + (vv ? Math.round(vv.width) + ' x ' + Math.round(vv.height) + ' @' + Math.round(vv.offsetTop) : 'n/a'),
      'phone box:  ' + Math.round(pb.width) + ' x ' + Math.round(pb.height) + ' @' + Math.round(pb.top),
      'safe top:   ' + cs.getPropertyValue('--safe-top').trim(),
      'safe btm:   ' + cs.getPropertyValue('--safe-bottom').trim(),
    ].join('\n');
    box.classList.add('show');
  });

  // Dev helper: ?state=drawer|actions|sheet|bottom|perps|send|sendamount|sendentered|sendmethod|sendreview|sendtoast opens a given state on load (and skips the intro).
  const state = new URLSearchParams(location.search).get('state');
  if (state === 'drawer') openDrawer();
  if (state === 'actions') actions.classList.add('open');
  if (state === 'sheet') openSheet();
  if (/^send/.test(state || '')) {
    openSend();
    if (state !== 'send') { chooseRecipient('61CebMwmu9k3VqTnYh2PzXw8LrDbiuxhXx6Rrf4tGaQz'); if (state !== 'sendamount') pressKey('5'); }
    if (state === 'sendmethod') openMethod();
    if (state === 'sendreview') setStep('review');
    if (state === 'sendtoast') confirmSend();
  }
  if (state === 'bottom') document.fonts.ready.then(() => { $('scroll').scrollTop = 1e6; });
  if (state === 'perps') $('perps').scrollLeft = 1e6;
  const scrollTo = new URLSearchParams(location.search).get('scroll');
  if (scrollTo) document.fonts.ready.then(() => { $('scroll').scrollTop = +scrollTo; });
  if (state === 'debug') setTimeout(() => {
    const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [Math.round(b.top * 10) / 10, Math.round(b.height * 10) / 10]; };
    const sc = $('scroll');
    document.body.dataset.debug = JSON.stringify({ scrollHeight: sc.scrollHeight, client: sc.clientHeight, content: r('.content'), disclaimer: r('.disclaimer'), perps: r('.perps'), preds: r('.predictions'), tabs: r('.tabs'), lines: Math.round(document.querySelector('.disclaimer').getBoundingClientRect().height / 20) });
  }, 500);
})();
