import * as E from './src/engine.js';
import { runEnemyTurn } from './src/replay.js';
import { readFileSync } from 'node:fs';
const cardDefs = JSON.parse(readFileSync('./samples/cards.json','utf8')).cards;
const enc = JSON.parse(readFileSync('./samples/encounter.json','utf8'));
const M = Object.fromEntries(cardDefs.map(c=>[c.id,c]));
E.validateCardDefs(cardDefs);

let pass=0, fail=0;
const t=(name,cond)=>{ cond?pass++:(fail++,console.log('FAIL:',name)); };
const pic=(g,who,id)=>{let u=g.sides[who].hand.find(x=>g.cards[x]===id); if(!u){u=g.nextUid++;g.cards[u]=id;g.sides[who].hand.unshift(u);}return u;};
const pure=(g)=>JSON.stringify(g,(k,v)=>{ if(k==='_rng') return undefined; if(k==='rngState') return g._rng?g._rng.state>>>0:v; return v;});

function fresh(seed=777){ return E.createGame(enc,M,seed); }

// --- 原子性：每种非法操作都在独立的新游戏上验证 ---
const cases = [
  ['0能量打牌', (g)=>{g.sides.player.energy=0; E.playCard(g,'player',pic(g,'player','strike'),'enemy',M);}],
  ['enemy牌指自己', (g)=>E.playCard(g,'player',pic(g,'player','strike'),'player',M)],
  ['不指目标', (g)=>E.playCard(g,'player',pic(g,'player','strike'),null,M)],
  ['self牌指敌人', (g)=>E.playCard(g,'player',pic(g,'player','flex'),'enemy',M)],
  ['结束后打牌', (g)=>{g.over=true; E.playCard(g,'player',pic(g,'player','strike'),'enemy',M);}],
  ['敌方回合玩家打牌', (g)=>{E.finishTurn(g,'player'); E.playCard(g,'player',pic(g,'player','strike'),'enemy',M);}],
  ['错回合结束回合', (g)=>E.finishTurn(g,'enemy')],
  ['打不在手上的uid', (g)=>E.playCard(g,'player',999999,'enemy',M)],
];
for(const [name,fn] of cases){
  const g=fresh(); const snap=pure(g);
  try{ fn(); console.log('FAIL(未拒绝):',name); fail++; }
  catch(e){ if(pure(g)!==snap){console.log('FAIL(状态变脏):',name,e.code);fail++;} else pass++; }
}
// 同一 uid 连打两次：第二次必须拒绝
{
  const g=fresh(); const u=pic(g,'player','quick_jab'); const snap=pure(g);
  E.playCard(g,'player',u,'enemy',M);
  try{E.playCard(g,'player',u,'enemy',M);console.log('FAIL(连打未拒绝)');fail++;}catch(e){pass++;}
}

// --- 伤害公式 ---
{
  const g=fresh(5); g.sides.player.statuses.strength=2; g.sides.enemy.statuses.vulnerable=2; g.sides.player.statuses.weak=1;
  const r=E.playCard(g,'player',pic(g,'player','strike'),'enemy',M);
  t('floor((6+2)*1.5*.75)=9', r.effects[0].hits[0].amount===9);
}
{
  const g=fresh(5); g.sides.enemy.block=5;
  const r=E.playCard(g,'player',pic(g,'player','twin_fang'),'enemy',M);
  t('多段1 甲减4', r.effects[0].hits[0].blocked===4 && r.effects[0].hits[0].hpLoss===0);
  t('多段2 甲减1血减3', r.effects[0].hits[1].blocked===1 && r.effects[0].hits[1].hpLoss===3);
}
{
  const g=fresh(5); g.sides.player.statuses.weak=1;
  t('虚弱 floor(4.5)=4', E.playCard(g,'player',pic(g,'player','strike'),'enemy',M).effects[0].hits[0].amount===4);
}
t('同种子完全一致', pure(fresh(123))===pure(fresh(123)));

// --- 回血封顶 / 放血穿甲 ---
{
  const g=fresh(9); g.sides.player.hp=79;
  const r=E.playCard(g,'player',pic(g,'player','second_wind'),null,M);
  t('回血封顶80', g.sides.player.hp===80 && r.effects.find(e=>e.kind==='heal').amount===1);
  const hp=g.sides.player.hp, block=g.sides.player.block;
  E.playCard(g,'player',pic(g,'player','bloodletting'),null,M);
  t('放血穿甲', g.sides.player.hp===hp-3 && g.sides.player.block===block && g.sides.player.energy===2+2);
}

// --- 存档读档后随机流接续（含敌方回合洗牌可能） ---
{
  const g=fresh(2024);
  const uid=g.sides.player.hand[0];
  E.playCard(g,'player',uid,'enemy',M);
  const restored=E.deserializeGame(E.serializeGame(g));
  const g2=fresh(2024); E.playCard(g2,'player',g2.sides.player.hand[0],'enemy',M);
  for(const it of runEnemyTurn(restored,M)){}
  for(const it of runEnemyTurn(g2,M)){}
  if(pure(restored)!==pure(g2)){
    const a=JSON.parse(pure(restored)), b=JSON.parse(pure(g2));
    console.log('rng:',a.rngState,b.rngState,'active:',a.active,b.active,'turn:',a.turn,b.turn);
    console.log('enemy hand:',a.sides.enemy.hand, b.sides.enemy.hand);
    console.log('player hand:',a.sides.player.hand.map(u=>a.cards[u]), b.sides.player.hand.map(u=>b.cards[u]));
    fail++;
  } else pass++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
