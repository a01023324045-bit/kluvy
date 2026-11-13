// 상세 카드의 '✈️ 비행 정보' 상자 — 편명 정규화·실시간 보기 링크·이륙/착륙(현지+KST)·AirLabs 조회 버튼
// 데이터는 textContent 로만 넣는다.
import { normalizeFlight, flightLinks, computeFlightTimes, airportCity, dayShift, sourceLabel } from '../flight.js';
import { getFlightTable, getAirlabsKey, lookupFlightOnAirlabs, onFlightTimesChanged } from '../flight-times.js';
import { statusKo } from '../airlabs.js';

let lastArgs = null;
let lastMsg = { key: '', text: '' };
onFlightTimesChanged(() => { if (lastArgs) renderFlightBox(...lastArgs); });

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function mmdd(k) { return k ? `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : ''; }

function timeLine(label, side, baseKey) {
  if (!side) return null;
  const row = el('div', 'fl-row');
  row.appendChild(el('span', 'fl-k', label));
  const where = side.code ? `${side.city || side.code}(${side.code})` : '';
  let txt = `${side.localDate && side.localDate !== baseKey ? mmdd(side.localDate) + ' ' : ''}${side.local} ${where} 현지`;
  if (side.known && side.kst) {
    const sh = dayShift(baseKey, side.kstDate);
    txt += side.code && ['ICN', 'GMP', 'PUS', 'CJU', 'TAE', 'CJJ', 'KWJ', 'MWX', 'YNY'].includes(side.code)
      ? (sh ? ` (${sh > 0 ? '+' : ''}${sh}일)` : '')
      : ` → 한국 ${side.kst}${sh ? ` (${sh > 0 ? '+' : ''}${sh}일)` : ''}`;
  } else if (!side.known) {
    txt += ' (공항 시간대를 몰라 현지시각만)';
  }
  // '(+1일)' 같은 꼬리가 줄 끝에서 혼자 넘어가지 않게 마지막 덩어리는 줄바꿈 금지
  const m = /^(.*?)(\s(?:→ 한국 \d\d:\d\d(?: \([+-]?\d+일\))?|\([+-]?\d+일\)))$/.exec(txt);
  const span = el('span', '');
  if (m) span.append(document.createTextNode(m[1]), el('span', 'nowrap', m[2]));
  else span.textContent = txt;
  row.appendChild(span);
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
  const f = gf && gf.flight ? normalizeFlight(gf.flight) : null;
  if (!f) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const table = getFlightTable();
  const entry = table[f.iata] || null;

  const wrap = el('div', 'flight-box');
  wrap.dataset.flight = f.iata;
  const title = el('div', 'fl-title');
  const dep = f.dep || (entry && entry.dep) || '';
  const arr = f.arr || (entry && entry.arr) || '';
  title.append(el('span', '', `✈️ ${f.iata}`));
  if (dep && arr) title.append(el('span', 'text-[13px] font-bold text-slate-600', `${airportCity(dep)}(${dep}) → ${airportCity(arr)}(${arr})`));
  if (f.multi) title.append(el('span', 'text-[12px] font-bold text-slate-500', '· 왕복 중 첫 편'));
  wrap.appendChild(title);

  // 이륙·착륙 예정: 근무표(체류 비행)의 시각 → 없으면 편명 시간표
  let std = '', sta = '', src = '';
  const quick = gf.isQuickTurn || gf.type === '퀵턴';
  if (!quick && !gf.isPureStay && !gf.isArrivalOnly && gf.start && gf.end && f.dep && f.arr) {
    std = gf.start; sta = gf.end; src = gf.timesFrom === 'flightTimes' ? `편명 시간표 (${sourceLabel(entry && entry.source)})` : '근무표';
  } else if (entry && (entry.std || entry.sta)) {
    std = entry.std || ''; sta = entry.sta || ''; src = `편명 시간표 (${sourceLabel(entry.source)})`;
  }
  if (std || sta) {
    const t = computeFlightTimes({ dep, arr, std, sta }, dateKey);
    if (t) {
      const a = timeLine('이륙', t.dep, dateKey);
      const b = timeLine('착륙', t.arr, dateKey);
      if (a) wrap.appendChild(a);
      if (b) wrap.appendChild(b);
      const extra = t.durationMin ? ` · 비행 약 ${Math.floor(t.durationMin / 60)}시간${t.durationMin % 60 ? ` ${t.durationMin % 60}분` : ''}` : '';
      wrap.appendChild(el('div', 'fl-src', `출처: ${src}${extra}`));
    }
  } else if (quick) {
    wrap.appendChild(el('div', 'fl-src', '퀵턴 시간은 왕복 근무 시간이라 편별 이륙·착륙은 실시간 보기 링크에서 확인하세요.'));
  } else {
    wrap.appendChild(el('div', 'fl-src', '이 편의 시각을 아직 모릅니다. 근무표에 시각이 있는 같은 편이 등록되면 자동으로 배웁니다.'));
  }

  // AirLabs 로 받은 실시간·정기 정보 (캐시)
  const live = entry && entry.days && entry.days[dateKey];
  if (live) {
    const lv = el('div', 'fl-live');
    const parts = [`예정 ${live.std || '-'}→${live.sta || '-'}`];
    if (live.etd || live.eta) parts.push(`예상 ${live.etd || '-'}→${live.eta || '-'}`);
    if (live.atd || live.ata) parts.push(`실제 ${live.atd || '-'}→${live.ata || '-'}`);
    if (live.depDelay) parts.push(`출발 ${live.depDelay}분 지연`);
    if (live.arrDelay) parts.push(`도착 ${live.arrDelay}분 지연`);
    lv.appendChild(el('div', 'font-bold', `🛰️ AirLabs${live.status ? ` · ${statusKo(live.status)}` : ''} (현지시각)`));
    lv.appendChild(el('div', '', parts.join(' · ')));
    if (live.fetchedAt && typeof live.fetchedAt === 'number') lv.appendChild(el('div', 'fl-src', `받은 시각 ${new Date(live.fetchedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`));
    wrap.appendChild(lv);
  } else if (entry && entry.airlabs && (entry.airlabs.std || entry.airlabs.sta)) {
    const lv = el('div', 'fl-live');
    lv.appendChild(el('div', 'font-bold', '🛰️ AirLabs 정기 노선 (현지시각)'));
    lv.appendChild(el('div', '', `${entry.airlabs.dep || ''} ${entry.airlabs.std || '-'} → ${entry.airlabs.arr || ''} ${entry.airlabs.sta || '-'}${Array.isArray(entry.airlabs.days) && entry.airlabs.days.length ? ` · 운항 요일 ${entry.airlabs.days.join(',')}` : ''}`));
    wrap.appendChild(lv);
  }

  const linkLabel = el('div', 'fl-src', `✈️ ${f.iata} 실시간 보기 (새 창)`);
  linkLabel.style.marginTop = '8px';
  linkLabel.style.fontWeight = '700';
  wrap.appendChild(linkLabel);
  const links = el('div', 'fl-links');
  links.style.marginTop = '4px';
  for (const l of flightLinks(f)) {
    const a = el('a', 'fl-link', `${l.name}`);
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', `${f.iata} ${l.name} 에서 실시간 보기`);
    a.prepend(el('i', 'fa-solid fa-arrow-up-right-from-square'));
    links.appendChild(a);
  }
  if (getAirlabsKey()) {
    const btn = el('button', 'fl-btn', '예정/실제 시각 불러오기');
    btn.type = 'button';
    btn.id = 'btnAirlabsLookup';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '불러오는 중...';
      const r = await lookupFlightOnAirlabs(gf.flight, dateKey);
      lastMsg = { key: `${f.iata}|${dateKey}`, text: r.message };
      renderFlightBox(box, dateKey, gf);
    };
    links.appendChild(btn);
  }
  wrap.appendChild(links);
  if (lastMsg.key === `${f.iata}|${dateKey}` && lastMsg.text) {
    const m = el('div', 'fl-msg', lastMsg.text);
    m.id = 'airlabsMsg';
    wrap.appendChild(m);
  }
  box.appendChild(wrap);
}
