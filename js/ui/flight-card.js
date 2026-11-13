// 상세 카드의 '✈️ 비행 정보' 상자 — 편명 정규화·실시간 보기 링크·이륙/착륙(현지+KST)·AirLabs 조회 버튼
// v2.3.1: 왕복(사진의 '721/806' = TW721 가는 편 + TW806 오는 편)이면 상자 하나 안에 편마다 한 줄(①·②)로 간결하게.
//         크게 보이는 시각은 flight-view.js pickLegTimes (직접 입력 > 근무표 > 실제 > 예상 > 시간표 > 정기),
//         AirLabs 는 정기·예상·실제·지연 라벨을 붙인 요약 한 줄 + 운항 날짜·구간 한 줄 + 안내 한 줄.
// 데이터는 textContent 로만 넣는다.
import { flightLinks, computeFlightTimes, airportCity, dayShift, KOREAN_AIRPORTS, gfFlights } from '../flight.js';
import { getFlightTable, getAirlabsKey, lookupFlightOnAirlabs, onFlightTimesChanged } from '../flight-times.js';
import { pickLegTimes, airlabsReference, FREE_PLAN_NOTE } from '../flight-view.js';

let lastArgs = null;
let lastMsg = { key: '', text: '' };
onFlightTimesChanged(() => { if (lastArgs) renderFlightBox(...lastArgs); });

const MARK = ['①', '②', '③', '④', '⑤', '⑥'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

/** 비행 관련 근무인가 (퀵턴·체류 출발/귀국일·비행·TR). L/O·도착일·OFF·대기(SBY/IS?/GS?)·직접입력 근무는 아님 */
export function isFlightDuty(gf) {
  if (!gf || !gf.type || gf.isPureStay || gf.isArrivalOnly) return false;
  return Boolean(gf.isQuickTurn) || ['퀵턴', '체류', '비행', 'TR'].includes(String(gf.type));
}

/** [편명 입력]·[시각 직접 입력] → 그 날짜 편집창을 열고 해당 칸으로 */
function openEditForFlight(focusId = 'inputGfFlight') {
  const open = typeof window !== 'undefined' && window.openEditModal;
  if (!open) return;
  open();
  setTimeout(() => {
    const inp = document.getElementById(focusId) || document.getElementById('inputGfFlight');
    if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
  }, 50);
}

function mmdd(k) { return k ? `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : ''; }

function kstTail(side, baseKey) {
  if (!side || !side.known || !side.kst) return '';
  const sh = dayShift(baseKey, side.kstDate);
  return side.code && KOREAN_AIRPORTS.includes(side.code)
    ? (sh ? ` (${sh > 0 ? '+' : ''}${sh}일)` : '')
    : ` → 한국 ${side.kst}${sh ? ` (${sh > 0 ? '+' : ''}${sh}일)` : ''}`;
}

function timeLine(label, side, baseKey, tag) {
  if (!side) return null;
  const row = el('div', 'fl-row');
  row.appendChild(el('span', 'fl-k', label));
  const where = side.code ? `${side.city || side.code}(${side.code})` : '';
  const span = el('span', '');
  const timeEl = el('b', `fl-time${tag ? ` fl-time--${tag === '정기' ? 'sched' : tag === '예상' ? 'est' : 'act'}` : ''}`, side.local);
  let rest = `${tag ? ` (${tag})` : ''} ${where} 현지`;
  const tail = kstTail(side, baseKey);
  if (!side.known) rest += ' (공항 시간대를 몰라 현지시각만)';
  const pre = side.localDate && side.localDate !== baseKey ? `${mmdd(side.localDate)} ` : '';
  span.append(document.createTextNode(pre), timeEl, document.createTextNode(rest));
  // '(+1일)' 같은 꼬리가 줄 끝에서 혼자 넘어가지 않게 마지막 덩어리는 줄바꿈 금지
  if (tail) span.appendChild(el('span', 'nowrap', tail));
  row.appendChild(span);
  return row;
}

function sourceText(pick, t) {
  const extra = t && t.durationMin ? ` · 비행 약 ${Math.floor(t.durationMin / 60)}시간${t.durationMin % 60 ? ` ${t.durationMin % 60}분` : ''}` : '';
  return `출처: ${pick.label}${extra}`;
}

/** AirLabs 참고 (요약 한 줄 + 운항 한 줄 + ⚠️ + 안내 한 줄) */
function airlabsBlock(ref, leg, entry, dateKey, i, pick, compact) {
  const lv = el('div', `fl-live${compact ? ' fl-live--compact' : ''}`);
  lv.dataset.leg = String(i);
  if (!compact) lv.appendChild(el('div', 'font-semibold', `🛰️ AirLabs 참고${pick && !pick.isAirlabs ? ' (위 시각이 우선)' : ''}`));
  if (ref.summary) lv.appendChild(el('div', `fl-al-sum${ref.live ? ' fl-al-strong' : ''}`, `${compact ? '🛰️ ' : ''}${ref.summary}`));
  // 왕복 줄 모드에서는 운항 날짜·구간 줄 생략 (요약에 날짜, 편 줄에 구간이 있음)
  for (const L of ref.lines) if (!compact || L.kind) lv.appendChild(el('div', `fl-al-line${L.kind ? ` fl-al--${L.kind}` : ''}`, L.text));
  for (const w of ref.warns) lv.appendChild(el('div', 'fl-warn', w));
  if (!compact) for (const nt of ref.notes) lv.appendChild(el('div', 'fl-src', nt));
  return lv;
}

/** 한 편 상세(편이 하나일 때): 제목 + 이륙/착륙(현지·한국) + 출처 + AirLabs 참고 */
function renderSingle(wrap, dateKey, gf, leg, entry) {
  const dep = leg.dep || (entry && entry.dep) || '';
  const arr = leg.arr || (entry && entry.arr) || '';
  const title = el('div', 'fl-title');
  title.append(el('span', '', `✈️ ${leg.iata}`));
  if (dep && arr) title.append(el('span', 'text-[13px] font-semibold text-slate-600', `${airportCity(dep)}(${dep}) → ${airportCity(arr)}(${arr})`));
  wrap.appendChild(title);
  const pick = pickLegTimes({ leg: { ...leg, dep, arr }, gf, entry, dateKey, legCount: 1 });
  let t = null;
  if (pick && (pick.std || pick.sta)) t = computeFlightTimes({ dep, arr, std: pick.std, sta: pick.sta }, dateKey);
  if (t) {
    const a = timeLine(pick.depLabel || '이륙', t.dep, dateKey, pick.depTag);
    const b = timeLine('착륙', t.arr, dateKey, pick.arrTag);
    if (a) wrap.appendChild(a);
    if (b) wrap.appendChild(b);
    const src = el('div', `fl-src fl-src--${pick.kind}`, sourceText(pick, t));
    src.dataset.kind = pick.kind;
    wrap.appendChild(src);
  } else {
    wrap.appendChild(el('div', 'fl-src', '이 편의 시각을 아직 모릅니다. 근무표에 시각이 있는 같은 편이 등록되면 자동으로 배웁니다.'));
  }
  const ref = airlabsReference({ leg: { ...leg, dep, arr }, entry, dateKey });
  if (ref) wrap.appendChild(airlabsBlock(ref, leg, entry, dateKey, 0, pick, false));
}

/** 여러 편(왕복): 편마다 한 줄 '① TW721 김포→제주 15:40 → 16:55 (예상)' + AirLabs 요약 */
function renderLegsCompact(wrap, dateKey, gf, legs, table) {
  wrap.appendChild(el('div', 'fl-title', `✈️ ${legs.map(l => l.iata).join(' · ')}`));
  const notes = [];
  legs.forEach((leg, i) => {
    const entry = table[leg.iata] || null;
    const dep = leg.dep || (entry && entry.dep) || '';
    const arr = leg.arr || (entry && entry.arr) || '';
    const row = el('div', 'fl-leg-row');
    row.dataset.leg = String(i);
    row.dataset.flight = leg.iata;
    const line = el('div', 'fl-leg-line');
    line.append(el('b', 'fl-leg-no', `${MARK[i] || `${i + 1}.`} ${leg.iata}`));
    if (dep && arr) line.append(document.createTextNode(` ${airportCity(dep)}→${airportCity(arr)} `));
    const pick = pickLegTimes({ leg: { ...leg, dep, arr }, gf, entry, dateKey, legCount: legs.length });
    const t = pick && (pick.std || pick.sta) ? computeFlightTimes({ dep, arr, std: pick.std, sta: pick.sta }, dateKey) : null;
    if (t) {
      const tag = pick.kind === 'manual' ? '직접 입력' : (pick.depTag === pick.arrTag ? pick.depTag : [pick.depTag, pick.arrTag].filter(Boolean).join('/'));
      const tm = el('span', `nowrap fl-time${pick.kind === 'estimated' || pick.kind === 'actual' ? ' fl-time--est' : pick.kind === 'scheduled' ? ' fl-time--sched' : ''}`, `${t.dep.local} → ${t.arr.local}`);
      line.append(tm);
      const tail = kstTail(t.arr, dateKey);
      if (tail) line.append(el('span', 'nowrap', tail));
      if (tag) line.append(el('span', `fl-leg-tag fl-src--${pick.kind}`, ` (${tag})`));
      line.dataset.kind = pick.kind;
    } else {
      line.append(el('span', 'fl-src', '시각 모름'));
    }
    row.appendChild(line);
    const ref = airlabsReference({ leg: { ...leg, dep, arr }, entry, dateKey });
    if (ref) { row.appendChild(airlabsBlock(ref, leg, entry, dateKey, i, pick, true)); notes.push(...ref.notes); }
    wrap.appendChild(row);
  });
  // 안내는 상자 전체에 한 줄만 (무료 플랜 안내가 있으면 그것)
  if (notes.length) wrap.appendChild(el('div', 'fl-src', notes.includes(FREE_PLAN_NOTE) ? FREE_PLAN_NOTE : notes[0]));
}

/**
 * @param {HTMLElement} box  #detailFlightBox
 * @param {string} dateKey
 * @param {object|null} gf
 */
export function renderFlightBox(box, dateKey, gf) {
  lastArgs = [box, dateKey, gf];
  box.innerHTML = '';
  const legs = gfFlights(gf);
  if (!legs.length) {
    // v2.3.0: 비행 근무인데 편명이 없으면 왜 비행 정보가 없는지 알려 줌 (조용히 숨기지 않음)
    if (isFlightDuty(gf)) {
      box.classList.remove('hidden');
      const wrap = el('div', 'flight-box');
      wrap.appendChild(el('div', 'fl-title', '✈️ 비행 정보'));
      const m = el('div', 'fl-msg', gf.flight
        ? `편명 '${gf.flight}' 을(를) 알아볼 수 없어 예정 시각을 볼 수 없습니다 — 편집창에서 편명을 TW405 처럼 넣으면 AirLabs/편명 시간표로 이륙·착륙 시각을 볼 수 있습니다.`
        : '편명이 없어 예정 시각을 볼 수 없습니다 — [편명 입력]으로 이 날만 넣거나, 근무표 사진을 다시 등록하면 사진에서 편명을 자동으로 채웁니다.');
      m.id = 'flightNoNumber';
      wrap.appendChild(m);
      const links = el('div', 'fl-links');
      const btn = el('button', 'fl-btn', '편명 입력');
      btn.type = 'button';
      btn.id = 'btnFlightNumberEdit';
      btn.addEventListener('click', () => openEditForFlight());
      links.appendChild(btn);
      wrap.appendChild(links);
      box.appendChild(wrap);
    } else {
      box.classList.add('hidden');
    }
    return;
  }
  box.classList.remove('hidden');
  const table = getFlightTable();
  const hasKey = Boolean(getAirlabsKey());
  const multi = legs.length > 1;
  const wrap = el('div', 'flight-box');
  wrap.dataset.flight = legs.map(l => l.iata).join('/');
  if (multi) renderLegsCompact(wrap, dateKey, gf, legs, table);
  else renderSingle(wrap, dateKey, gf, legs[0], table[legs[0].iata] || null);

  // 실시간 보기 링크 (편마다) + AirLabs 조회(모든 편) + 시각 직접 입력
  const linkLabel = el('div', 'fl-src', multi ? '✈️ 실시간 보기 (새 창)' : `✈️ ${legs[0].iata} 실시간 보기 (새 창)`);
  linkLabel.style.marginTop = '8px';
  linkLabel.style.fontWeight = '600';
  wrap.appendChild(linkLabel);
  const links = el('div', 'fl-links');
  links.style.marginTop = '4px';
  legs.forEach((leg, i) => {
    for (const l of flightLinks(leg)) {
      const a = el('a', 'fl-link', multi ? `${MARK[i] || i + 1} ${l.name === 'Flightradar24' ? 'FR24' : l.name}` : l.name);
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${leg.iata} ${l.name} 에서 실시간 보기`);
      a.prepend(el('i', 'fa-solid fa-arrow-up-right-from-square'));
      links.appendChild(a);
    }
  });
  const msgKey = `${legs.map(l => l.iata).join('/')}|${dateKey}`;
  if (hasKey) {
    const btn = el('button', 'fl-btn', '예정/실제 시각 불러오기');
    btn.type = 'button';
    btn.id = 'btnAirlabsLookup';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '불러오는 중...';
      const msgs = [];
      let ok = true;
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const e = table[leg.iata] || {};
        const dep = leg.dep || e.dep || '', arr = leg.arr || e.arr || '';
        let r;
        try { r = await lookupFlightOnAirlabs(dep && arr ? `${leg.iata} ${dep}-${arr}` : leg.iata, dateKey); } catch (err) { r = { ok: false, message: `조회 중 오류: ${err && err.message ? err.message : err}` }; }
        ok = ok && r.ok;
        msgs.push(multi ? `${MARK[i] || i + 1} ${r.message}` : r.message);
        if (!r.ok && /키/.test(r.message)) break; // 키 오류면 다음 편도 같음
      }
      lastMsg = { key: msgKey, text: msgs.join(' / '), ok };
      renderFlightBox(box, dateKey, gf);
    };
    links.appendChild(btn);
  }
  const manualBtn = el('button', 'fl-link fl-manual', '시각 직접 입력');
  manualBtn.type = 'button';
  manualBtn.id = 'btnFlightManual';
  manualBtn.addEventListener('click', () => openEditForFlight('inputGfFl1Std'));
  links.appendChild(manualBtn);
  wrap.appendChild(links);
  if (lastMsg.key === msgKey && lastMsg.text) {
    const m = el('div', `fl-msg${lastMsg.ok === false ? ' fl-msg--err' : ''}`, lastMsg.text);
    m.id = 'airlabsMsg';
    wrap.appendChild(m);
  }
  if (!hasKey) {
    const m = el('div', 'fl-msg', '🛰️ AirLabs 키를 넣으면 예정/실제 시각을 볼 수 있습니다 — [N월 등록] → 「✈️ AirLabs (비행 시각 조회, 선택)」 칸에 붙여 넣으세요.');
    m.id = 'airlabsNoKey';
    wrap.appendChild(m);
  }
  box.appendChild(wrap);
}
