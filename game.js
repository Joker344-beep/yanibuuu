// ヤニブのゲーム進行（部屋を作った人のブラウザ、または server.js が持つ正本）
const SUITS = ['♠', '♥', '♦', '♣'];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function newDeck() {
  let id = 0;
  const d = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) d.push({ s, r, id: id++ });
  d.push({ s: 'JK', r: 0, id: id++ }, { s: 'JK', r: 0, id: id++ });
  return shuffle(d);
}
const pts = c => (c.r === 0 ? 0 : Math.min(c.r, 10));
const total = h => h.reduce((a, c) => a + pts(c), 0);
const label = c => (c.r === 0 ? 'JK' : ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[c.r] || String(c.r)));
const cardName = c => (c.r === 0 ? 'ジョーカー' : c.s + label(c));
const groupName = g => g.map(cardName).join('・');
const sortHand = h => h.sort((a, b) => (a.r || 99) - (b.r || 99) || SUITS.indexOf(a.s) - SUITS.indexOf(b.s));
const ends = g => (g.length === 1 ? [0] : [0, g.length - 1]);

// 出せる形かを判定し、並べた順で返す（ジョーカーは代用）。出せなければ null
function analyze(cards) {
  const n = cards.length;
  if (!n) return null;
  if (n === 1) return cards.slice();
  const jk = cards.filter(c => c.r === 0), nj = cards.filter(c => c.r !== 0);
  if (nj.every(c => c.r === nj[0].r)) return [...nj, ...jk];
  if (n >= 3 && nj.every(c => c.s === nj[0].s)) {
    const rs = nj.map(c => c.r).sort((a, b) => a - b);
    if (new Set(rs).size === rs.length) {
      const s = Math.min(rs[0], 14 - n);
      if (s >= 1 && s + n - 1 >= rs[rs.length - 1]) {
        const byR = new Map(nj.map(c => [c.r, c])), js = [...jk], order = [];
        for (let r = s; r < s + n; r++) order.push(byR.get(r) || js.pop());
        return order;
      }
    }
  }
  return null;
}

class Game {
  constructor() {
    this.players = []; // {name, score, hand}
    this.phase = 'lobby'; // lobby | play | draw | result
    this.round = 0;
    this.starter = 0;
    this.log = [];
    this.deck = [];
    this.pile = [];
    this.pending = null;
    this.result = null;
  }

  addPlayer(name) {
    if (this.phase !== 'lobby') throw new Error('ゲームが始まっているので参加できません');
    if (this.players.length >= 5) throw new Error('この部屋は満員です（5人まで）');
    this.players.push({ name, score: 0, hand: [] });
    return this.players.length - 1;
  }

  start(seat) {
    if (this.phase !== 'lobby') throw new Error('すでに始まっています');
    if (seat !== 0) throw new Error('開始できるのは部屋を作った人だけです');
    if (this.players.length < 3) throw new Error('3人以上そろうと始められます');
    this.startRound();
  }

  startRound() {
    this.round++;
    this.deck = newDeck();
    for (const p of this.players) { p.hand = this.deck.splice(0, 5); sortHand(p.hand); }
    this.pile = [[this.deck.pop()]]; // 出された組のリスト（最後が一番上）
    this.cur = this.starter;
    this.phase = 'play';
    this.pending = null;
    this.result = null;
    this.log.push(`第${this.round}ラウンド開始。最初は ${this.players[this.cur].name} さん。`);
  }

  top() { return this.pile[this.pile.length - 1]; }

  checkTurn(seat, phase) {
    if (this.phase !== phase || this.cur !== seat) throw new Error('今はその操作はできません');
  }

  play(seat, ids) {
    this.checkTurn(seat, 'play');
    const p = this.players[seat];
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    const chosen = p.hand.filter(c => idSet.has(c.id));
    if (!chosen.length || chosen.length !== idSet.size) throw new Error('カードを選んでください');
    const order = analyze(chosen);
    if (!order) throw new Error('その組み合わせは出せません');
    p.hand = p.hand.filter(c => !idSet.has(c.id));
    this.pending = order;
    this.phase = 'draw';
  }

  undo(seat) {
    this.checkTurn(seat, 'draw');
    const p = this.players[seat];
    p.hand.push(...this.pending);
    sortHand(p.hand);
    this.pending = null;
    this.phase = 'play';
  }

  refillDeck() {
    // 捨て札の一番上（前の人が出した組）だけ残して、残りを混ぜて山札に
    const keep = this.pile.pop();
    this.deck = shuffle(this.pile.flat());
    this.pile = [keep];
  }

  draw(seat, from, idx) {
    this.checkTurn(seat, 'draw');
    const p = this.players[seat];
    let card, how;
    if (from === 'deck') {
      if (!this.deck.length) this.refillDeck();
      if (!this.deck.length) throw new Error('山札がありません');
      card = this.deck.pop();
      how = '山札から引いた';
    } else {
      const g = this.top();
      if (!ends(g).includes(idx)) throw new Error('取れるのは端のカードだけです');
      card = g.splice(idx, 1)[0];
      how = `捨て札の ${cardName(card)} を取った`;
      if (!g.length) this.pile.pop();
    }
    p.hand.push(card);
    sortHand(p.hand);
    this.log.push(`${p.name}：${groupName(this.pending)} を出して、${how}`);
    this.pile.push(this.pending);
    this.pending = null;
    if (!this.deck.length && this.pile.length > 1) {
      this.refillDeck();
      this.log.push('山札がなくなったので捨て札を混ぜ直しました');
    }
    this.cur = (this.cur + 1) % this.players.length;
    this.phase = 'play';
  }

  yaniv(seat) {
    this.checkTurn(seat, 'play');
    const n = this.players.length, d = seat;
    const t = this.players.map(p => total(p.hand));
    if (t[d] > 5) throw new Error('合計が5以下のときだけ宣言できます');
    const others = [];
    for (let k = 1; k < n; k++) others.push((d + k) % n); // 宣言者の次から近い順
    const delta = Array(n).fill(0);
    let text, loser;
    const counters = others.filter(i => t[i] <= t[d]);
    if (counters.length) {
      const m = Math.min(...counters.map(i => t[i]));
      const w = counters.find(i => t[i] === m);
      delta[d] = -15; delta[w] = 15; loser = d;
      text = `ヤニブ返し！ ${this.players[w].name} さんが返しました`;
    } else {
      const m = Math.max(...others.map(i => t[i]));
      const hi = others.find(i => t[i] === m);
      const diff = m - t[d];
      delta[d] = diff; delta[hi] = -diff; loser = hi;
      text = `ヤニブ成功！ 差 ＝ ${m} − ${t[d]} ＝ ${diff}`;
    }
    this.players.forEach((p, i) => (p.score += delta[i]));
    this.result = { declarer: d, totals: t, delta, text, loser, hands: this.players.map(p => p.hand) };
    this.log.push(`${this.players[d].name} がヤニブ宣言（合計 ${t[d]}）。${text}`);
    this.starter = loser;
    this.phase = 'result';
  }

  next() {
    if (this.phase !== 'result') throw new Error('今は次のラウンドに進めません');
    this.startRound();
  }

  // そのプレイヤーに見せてよい情報だけを返す
  view(seat, online) {
    const me = this.players[seat];
    return {
      phase: this.phase,
      round: this.round,
      you: seat,
      cur: this.cur,
      players: this.players.map((p, i) => ({
        name: p.name, score: p.score, handCount: p.hand.length, online: online.includes(i),
      })),
      deckCount: this.deck.length,
      canDeck: this.deck.length > 0 || this.pile.length > 1,
      top: this.phase === 'lobby' ? null : this.top(),
      pending: this.pending,
      hand: me.hand,
      total: total(me.hand),
      log: this.log.slice(-10),
      result: this.result,
    };
  }
}

// Node（server.js）からも、ブラウザ（<script src="game.js">）からも使えるように
if (typeof module !== 'undefined' && module.exports) module.exports = { Game, analyze };
