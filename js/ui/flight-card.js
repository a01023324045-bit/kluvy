// 상세 카드의 '✈️ 비행 정보' 상자 — 편명 정규화·실시간 보기 링크·이륙/착륙(현지+KST)·AirLabs 조회 버튼
// v2.4.0: 하루에 레그(편)가 2개 이상(왕복 721/806·퀵턴 241/242/243/244)이면 상단에 레그 칩(1 TW721 · 2 TW806 …)을 두고
//         고른 레그 하나만 자세히 보여 준다(시각·출처·AirLabs 참고·실시간 링크·[N레그 예정/실제 시각 불러오기]).
//         기본은 1레그, 선택은 같은 날짜를 보고 있는 동안만 유지(다른 날짜로 갔다 오면 1레그). AirLabs 는 고른 레그만 조회(한도 절약).
//         크게 보이는 시각은 flight-view.js pickLegTimes (직접 입력 > 근무표 > 실제 > 예상 > 시간표 > 정기),
//         AirLabs 는 정기·예상·실제·지연 라벨을 붙인 요약 한 줄 + 운항 날짜·구간 한 줄 + 안내 한 줄.
// 데이터는 textContent 로만 넣는다.
import { flightLinks, computeFlightTimes, airportCity, dayShift, KOREAN_AIRPORTS, gfFlights } from '../flight.js';
import { getFlightTable, getAirlabsKey, lookupFlightOnAirlabs, onFlightTimesChanged } from '../flight-times.js';
import { pickLegTimes, airlabsReference, resolveLegSelection, clampLeg, legChipLabel, lookupButtonText } from '../flight-view.js';

let lastArgs = null;
let lastMsg = { key: '', text: '' };
let legSel = null; // { sig, idx } — 고른 레그 (resolveLegSelection)
onFlightTimesChanged(() => { if (lastArgs) renderFlightBox(...lastArgs); });

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

/** 한 레그 상세: 제목 + 이륙/착륙(현지·한국) + 출처 + AirLabs 참고 (레그 칩에서 고른 레그도 같은 모양) */
function renderLeg(wrap, dateKey, gf, leg, entry, idx, legCount) {
  const dep = leg.dep || (entry && entry.dep) || '';
  const arr = leg.arr || (entry && entry.arr) || '';
  const title = el('div', 'fl-title');
  title.append(el('span', '', `✈️ ${leg.iata}`));
  if (dep && arr) title.append(el('span', 'text-[13px] font-semibold text-slate-600', `${airportCity(dep)}(${dep}) → ${airportCity(arr)}(${arr})`));
  wrap.appendChild(title);
  const pick = pickLegTimes({ leg: { ...leg, dep, arr }, gf, entry, dateKey, legCount });
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
    wrap.appendChild(el('div', 'fl-src', `${legCount > 1 ? `${idx + 1}레그` : '이 편'}의 시각을 아직 모릅니다. 근무표에 시각이 있는 같은 편이 등록되면 자동으로 배웁니다.`));
  }
  const ref = airlabsReference({ leg: { ...leg, dep, arr }, entry, dateKey });
  if (ref) wrap.appendChild(airlabsBlock(ref, leg, entry, dateKey, idx, pick, false));
}

/** 레그 칩 줄 (레그가 2개 이상일 때): [1 TW721] [2 TW806] … — 눌러서 그 레그만 본다 */
function renderChips(box, dateKey, gf, legs, sel) {
  const row = el('div', 'fl-legs');
  row.setAttribute('role', 'tablist');
  row.setAttribute('aria-label', '레그 선택');
  row.style.setProperty('--legs', String(Math.min(legs.length, 4)));
  legs.forEach((leg, i) => {
    const b = el('button', `fl-leg-chip${i === sel ? ' is-on' : ''}`, legChipLabel(leg, i));
    b.type = 'button';
    b.dataset.leg = String(i);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === sel));
    b.setAttribute('aria-label', `${i + 1}레그 ${leg.iata}`);
    b.addEventListener('click', () => {
      legSel = { sig: legSel ? legSel.sig : '', idx: i };
      renderFlightBox(box, dateKey, gf);
    });
    row.appendChild(b);
  });
  return row;
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
  if (!legs.length) legSel = null; // 비행 없는 날을 거치면 다음에 비행 날을 열 때 1레그부터
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
  legSel = resolveLegSelection(legSel, dateKey, legs); // 같은 날짜가 열려 있는 동안만 고른 레그 유지, 아니면 1레그
  const sel = clampLeg(legSel.idx, legs.length);
  const leg = legs[sel];
  const wrap = el('div', 'flight-box');
  wrap.dataset.flight = legs.map(l => l.iata).join('/');
  wrap.dataset.selectedLeg = String(sel);
  wrap.dataset.legCount = String(legs.length);
  if (multi) wrap.appendChild(renderChips(box, dateKey, gf, legs, sel));
  renderLeg(wrap, dateKey, gf, leg, table[leg.iata] || null, sel, legs.length);

  // 실시간 보기 링크 (고른 레그) + AirLabs 조회(고른 레그만) + 시각 직접 입력
  const linkLabel = el('div', 'fl-src', `✈️ ${leg.iata} 실시간 보기 (새 창)`);
  linkLabel.style.marginTop = '8px';
  linkLabel.style.fontWeight = '600';
  wrap.appendChild(linkLabel);
  const links = el('div', 'fl-links');
  links.style.marginTop = '4px';
  for (const l of flightLinks(leg)) {
    const a = el('a', 'fl-link', l.name);
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', `${leg.iata} ${l.name} 에서 실시간 보기`);
    a.prepend(el('i', 'fa-solid fa-arrow-up-right-from-square'));
    links.appendChild(a);
  }
  const msgKey = `${leg.iata}|${dateKey}`;
  if (hasKey) {
    const btn = el('button', 'fl-btn', lookupButtonText(sel, legs.length));
    btn.type = 'button';
    btn.id = 'btnAirlabsLookup';
    btn.dataset.leg = String(sel);
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '불러오는 중...';
      const e = table[leg.iata] || {};
      const dep = leg.dep || e.dep || '', arr = leg.arr || e.arr || '';
      let r;
      try { r = await lookupFlightOnAirlabs(dep && arr ? `${leg.iata} ${dep}-${arr}` : leg.iata, dateKey); } catch (err) { r = { ok: false, message: `조회 중 오류: ${err && err.message ? err.message : err}` }; }
      lastMsg = { key: msgKey, text: multi ? `${sel + 1}레그 ${r.message}` : r.message, ok: r.ok };
      renderFlightBox(box, dateKey, gf);
    };
    links.appendChild(btn);
  }
  const manualBtn = el('button', 'fl-link fl-manual', '시각 직접 입력');
  manualBtn.type = 'button';
  manualBtn.id = 'btnFlightManual';
  manualBtn.addEventListener('click', () => openEditForFlight(`inputGfFl${sel + 1}Std`));
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
