// 알려진 장소(트리니티항공 취항지) — 한글 도시명·별칭·IATA 공항코드·IANA 시간대의 '하나뿐인 원천'
// timezone.js(체류지 현지시각 → 한국시각), flight.js(공항 시간대), schedule-model.js(체류지 판정)가 모두 이 표를 쓴다.
//
// 출처 (2026-11-14 조사)
//  - 트리니티항공 회사 소개 - 취항 노선: https://www.trinityairways.com/app/serviceInfo/contents/1329
//    (사이트가 스크립트로 그려 직접 읽지 못해, 같은 페이지를 출처로 단 영문 위키백과 표로 확인)
//  - Wikipedia "Trinity Airways" Destinations 표 (2026-10 기준, 위 공식 페이지 인용):
//    https://en.wikipedia.org/wiki/Trinity_Airways#Destinations
//  - 국토교통부 공공데이터 기반 정기편 시간표 (MustardData, W26 시즌 67개 노선·46개 취항지):
//    https://flight.mustarddata.com/airlines/tway-air/  — 인천→시드니 TW501 21:40 매일 / 시드니→인천 TW502
//  - 고베 2026-12-18 신규(연합뉴스 2026-09-16), 자카르타 2026-04-29 신규(조선비즈 2026-02-10),
//    비엔티안·치앙마이 2027-01-07 재개, 프랑크푸르트 운휴(서울경제 2026-08-14) — 운휴·과거 취항지도 옛 근무 기록을 위해 남겨 둔다.
//  - 운영본(v1) 시차표 도시 21곳 + v2.2.0 flight.js 공항표는 모두 포함.
//
// 시간대 규칙
//  - 시차는 날짜마다 IANA 시간대로 계산(서머타임 반영): 시드니 AEDT(10월 첫 일요일~4월 첫 일요일) = KST+2, 그 밖 KST+1
//    유럽(로마·파리·바르셀로나·프랑크푸르트·자그레브) 3월 마지막 일요일~10월 마지막 일요일 = KST-7, 그 밖 KST-8
//  - rule {from, tz}: 그 날짜부터는 다른 시간대로 고정 (폰의 시간대 DB 가 옛것이어도 맞게)
//    · 밴쿠버: BC주 2026-11-01부터 서머타임 영구화 = UTC-7 고정 (https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/daylight-saving-time)
//    · 카자흐스탄(알마티·아스타나): 2024-03-01부터 전국 UTC+5 단일 시간대 (정부 결정, IANA 2024a 반영)
//  - legacy: 운영본 고정 시차(시간) — 날짜를 모를 때만 쓰는 옛 값 (운영본 도시만)
//  - stay: 체류 비행지 (사진·간편 입력에서 '체류'로 판정). 운영본 목록 + 왕복 당일 근무가 불가능한 장거리만 추가
//
// 이 표에 없는 목적지는 화면에 '(KR ?)' 로 표시되고 console.warn 으로 알린다 (조용히 빠지지 않게).

/**
 * @typedef {{ name:string, country:string, tz:string, iata:string[], aliases?:string[], en?:string[],
 *             legacy?:number, stay?:boolean, rule?:{from:string, tz:string}, note?:string }} Place
 */
/** @type {ReadonlyArray<Place>} */
export const PLACES = Object.freeze([
  // ---- 대한민국 (KST — 한국시각 표기 불필요, '알려진 장소'로만 등록) ----
  { name: '인천', country: 'KR', tz: 'Asia/Seoul', iata: ['ICN'], aliases: ['서울'], en: ['incheon', 'seoul'] },
  { name: '김포', country: 'KR', tz: 'Asia/Seoul', iata: ['GMP'], en: ['gimpo'] },
  { name: '부산', country: 'KR', tz: 'Asia/Seoul', iata: ['PUS'], aliases: ['김해'], en: ['busan', 'gimhae'], stay: true },
  { name: '제주', country: 'KR', tz: 'Asia/Seoul', iata: ['CJU'], en: ['jeju'] },
  { name: '대구', country: 'KR', tz: 'Asia/Seoul', iata: ['TAE'], en: ['daegu'] },
  { name: '청주', country: 'KR', tz: 'Asia/Seoul', iata: ['CJJ'], en: ['cheongju'] },
  { name: '광주', country: 'KR', tz: 'Asia/Seoul', iata: ['KWJ'], en: ['gwangju'] },
  { name: '무안', country: 'KR', tz: 'Asia/Seoul', iata: ['MWX'], en: ['muan'] },
  { name: '양양', country: 'KR', tz: 'Asia/Seoul', iata: ['YNY'], en: ['yangyang'] },

  // ---- 일본 (KST 와 같은 시각 — 표기 불필요) ----
  { name: '도쿄', country: 'JP', tz: 'Asia/Tokyo', iata: ['NRT'], aliases: ['나리타', '도쿄/나리타'], en: ['tokyo', 'narita'] },
  { name: '하네다', country: 'JP', tz: 'Asia/Tokyo', iata: ['HND'], en: ['haneda'] },
  { name: '오사카', country: 'JP', tz: 'Asia/Tokyo', iata: ['KIX'], aliases: ['간사이', '오사카/간사이'], en: ['osaka', 'kansai'] },
  { name: '고베', country: 'JP', tz: 'Asia/Tokyo', iata: ['UKB'], en: ['kobe'], note: '2026-12-18 신규' },
  { name: '후쿠오카', country: 'JP', tz: 'Asia/Tokyo', iata: ['FUK'], en: ['fukuoka'] },
  { name: '나고야', country: 'JP', tz: 'Asia/Tokyo', iata: ['NGO'], en: ['nagoya'] },
  { name: '오키나와', country: 'JP', tz: 'Asia/Tokyo', iata: ['OKA'], aliases: ['나하'], en: ['okinawa', 'naha'] },
  { name: '삿포로', country: 'JP', tz: 'Asia/Tokyo', iata: ['CTS'], aliases: ['치토세', '신치토세'], en: ['sapporo'] },
  { name: '구마모토', country: 'JP', tz: 'Asia/Tokyo', iata: ['KMJ'], en: ['kumamoto'] },
  { name: '오이타', country: 'JP', tz: 'Asia/Tokyo', iata: ['OIT'], en: ['oita'] },
  { name: '가고시마', country: 'JP', tz: 'Asia/Tokyo', iata: ['KOJ'], en: ['kagoshima'] },
  { name: '사가', country: 'JP', tz: 'Asia/Tokyo', iata: ['HSG'], en: ['saga'] },
  { name: '기타큐슈', country: 'JP', tz: 'Asia/Tokyo', iata: ['KKJ'], en: ['kitakyushu'] },
  { name: '다카마쓰', country: 'JP', tz: 'Asia/Tokyo', iata: ['TAK'], aliases: ['다카마츠'], en: ['takamatsu'] },
  { name: '미야코', country: 'JP', tz: 'Asia/Tokyo', iata: ['SHI'], aliases: ['시모지시마'], en: ['miyako'] },
  { name: '히로시마', country: 'JP', tz: 'Asia/Tokyo', iata: ['HIJ'], en: ['hiroshima'] },
  { name: '우베', country: 'JP', tz: 'Asia/Tokyo', iata: ['UBJ'], aliases: ['야마구치'], en: ['ube'] },
  { name: '센다이', country: 'JP', tz: 'Asia/Tokyo', iata: ['SDJ'], en: ['sendai'] },

  // ---- 중국 (KST-1) ----
  { name: '칭다오', country: 'CN', tz: 'Asia/Shanghai', iata: ['TAO'], en: ['qingdao'] },
  { name: '선양', country: 'CN', tz: 'Asia/Shanghai', iata: ['SHE'], aliases: ['심양'], en: ['shenyang'], legacy: -1 },
  { name: '우한', country: 'CN', tz: 'Asia/Shanghai', iata: ['WUH'], en: ['wuhan'], legacy: -1 },
  { name: '지난', country: 'CN', tz: 'Asia/Shanghai', iata: ['TNA'], aliases: ['제남'], en: ['jinan'] },
  { name: '싼야', country: 'CN', tz: 'Asia/Shanghai', iata: ['SYX'], aliases: ['산야', '삼아'], en: ['sanya'] },
  { name: '하이커우', country: 'CN', tz: 'Asia/Shanghai', iata: ['HAK'], en: ['haikou'] },
  { name: '원저우', country: 'CN', tz: 'Asia/Shanghai', iata: ['WNZ'], aliases: ['온주'], en: ['wenzhou'] },
  { name: '장자제', country: 'CN', tz: 'Asia/Shanghai', iata: ['DYG'], aliases: ['장가계', '다융'], en: ['zhangjiajie'] },
  { name: '옌지', country: 'CN', tz: 'Asia/Shanghai', iata: ['YNJ'], aliases: ['연길'], en: ['yanji'] },
  { name: '상하이', country: 'CN', tz: 'Asia/Shanghai', iata: ['PVG'], aliases: ['상해', '푸둥'], en: ['shanghai'] },
  { name: '베이징', country: 'CN', tz: 'Asia/Shanghai', iata: ['PEK', 'PKX'], aliases: ['북경'], en: ['beijing'] },
  { name: '린이', country: 'CN', tz: 'Asia/Shanghai', iata: ['LYI'], en: ['linyi'] },
  { name: '바오터우', country: 'CN', tz: 'Asia/Shanghai', iata: ['BAV'], aliases: ['바우터우'], en: ['baotou'] },
  { name: '하이라얼', country: 'CN', tz: 'Asia/Shanghai', iata: ['HLD'], aliases: ['후룬베이얼'], en: ['hailar'] },
  { name: '윈청', country: 'CN', tz: 'Asia/Shanghai', iata: ['YCU'], en: ['yuncheng'] },
  { name: '엔시', country: 'CN', tz: 'Asia/Shanghai', iata: ['ENH'], en: ['enshi'] },
  { name: '구이린', country: 'CN', tz: 'Asia/Shanghai', iata: ['KWL'], aliases: ['계림'], en: ['guilin'] },
  { name: '난닝', country: 'CN', tz: 'Asia/Shanghai', iata: ['NNG'], aliases: ['남녕'], en: ['nanning'] },
  { name: '쉬저우', country: 'CN', tz: 'Asia/Shanghai', iata: ['XUZ'], aliases: ['서주'], en: ['xuzhou'] },

  // ---- 대만·홍콩·마카오 (KST-1) ----
  { name: '타이베이', country: 'TW', tz: 'Asia/Taipei', iata: ['TPE', 'TSA'], aliases: ['타이페이', '타오위안', '쑹산', '송산'], en: ['taipei'], legacy: -1 },
  { name: '타이중', country: 'TW', tz: 'Asia/Taipei', iata: ['RMQ'], aliases: ['칭촨강'], en: ['taichung'], legacy: -1 },
  { name: '가오슝', country: 'TW', tz: 'Asia/Taipei', iata: ['KHH'], aliases: ['카오슝'], en: ['kaohsiung'], legacy: -1 },
  { name: '홍콩', country: 'HK', tz: 'Asia/Hong_Kong', iata: ['HKG'], en: ['hong kong', 'hongkong'], legacy: -1 },
  { name: '마카오', country: 'MO', tz: 'Asia/Macau', iata: ['MFM'], en: ['macau', 'macao'] },

  // ---- 동남아 ----
  { name: '다낭', country: 'VN', tz: 'Asia/Ho_Chi_Minh', iata: ['DAD'], en: ['da nang', 'danang'], legacy: -2, stay: true },
  { name: '나트랑', country: 'VN', tz: 'Asia/Ho_Chi_Minh', iata: ['CXR'], aliases: ['냐짱', '캄란', '깜라인', '깜란'], en: ['nha trang', 'cam ranh'], legacy: -2, stay: true },
  { name: '푸꾸옥', country: 'VN', tz: 'Asia/Ho_Chi_Minh', iata: ['PQC'], aliases: ['푸쿠옥'], en: ['phu quoc'], legacy: -2, stay: true },
  { name: '하노이', country: 'VN', tz: 'Asia/Ho_Chi_Minh', iata: ['HAN'], aliases: ['노이바이'], en: ['hanoi'] },
  { name: '호찌민', country: 'VN', tz: 'Asia/Ho_Chi_Minh', iata: ['SGN'], aliases: ['호치민', '사이공'], en: ['ho chi minh', 'saigon'] },
  { name: '방콕', country: 'TH', tz: 'Asia/Bangkok', iata: ['BKK', 'DMK'], aliases: ['수완나품', '돈므앙'], en: ['bangkok'], legacy: -2, stay: true },
  { name: '치앙마이', country: 'TH', tz: 'Asia/Bangkok', iata: ['CNX'], en: ['chiang mai'], legacy: -2, stay: true },
  { name: '비엔티안', country: 'LA', tz: 'Asia/Vientiane', iata: ['VTE'], aliases: ['비엔티엔', '위앙짠'], en: ['vientiane'] },
  { name: '싱가포르', country: 'SG', tz: 'Asia/Singapore', iata: ['SIN'], aliases: ['창이', '싱가폴'], en: ['singapore'], legacy: -1, stay: true },
  { name: '세부', country: 'PH', tz: 'Asia/Manila', iata: ['CEB'], aliases: ['막탄'], en: ['cebu', 'mactan'], stay: true },
  { name: '칼리보', country: 'PH', tz: 'Asia/Manila', iata: ['KLO'], aliases: ['보라카이'], en: ['kalibo', 'boracay'], stay: true },
  { name: '클락', country: 'PH', tz: 'Asia/Manila', iata: ['CRK'], aliases: ['클라크'], en: ['clark'] },
  { name: '마닐라', country: 'PH', tz: 'Asia/Manila', iata: ['MNL'], en: ['manila'] },
  { name: '보홀', country: 'PH', tz: 'Asia/Manila', iata: ['TAG'], aliases: ['팡라오'], en: ['bohol'] },
  { name: '코타키나발루', country: 'MY', tz: 'Asia/Kuching', iata: ['BKI'], en: ['kota kinabalu'] },
  { name: '자카르타', country: 'ID', tz: 'Asia/Jakarta', iata: ['CGK'], aliases: ['수카르노하타'], en: ['jakarta'], legacy: -2, stay: true },
  { name: '발리', country: 'ID', tz: 'Asia/Makassar', iata: ['DPS'], aliases: ['덴파사르', '응우라라이'], en: ['bali', 'denpasar'], stay: true },

  // ---- 몽골·중앙아시아 ----
  { name: '울란바토르', country: 'MN', tz: 'Asia/Ulaanbaatar', iata: ['UBN'], aliases: ['울란바타르'], en: ['ulaanbaatar'], legacy: -1 },
  { name: '비슈케크', country: 'KG', tz: 'Asia/Bishkek', iata: ['FRU'], aliases: ['마나스'], en: ['bishkek'], legacy: -3, stay: true },
  { name: '알마티', country: 'KZ', tz: 'Asia/Almaty', rule: { from: '2024-03-01', tz: 'Etc/GMT-5' }, iata: ['ALA'], en: ['almaty'], stay: true },
  { name: '아스타나', country: 'KZ', tz: 'Asia/Almaty', rule: { from: '2024-03-01', tz: 'Etc/GMT-5' }, iata: ['NQZ'], en: ['astana'], stay: true },
  { name: '타슈켄트', country: 'UZ', tz: 'Asia/Tashkent', iata: ['TAS'], en: ['tashkent'], stay: true },

  // ---- 러시아 극동 (운휴 — 옛 기록용) ----
  { name: '블라디보스토크', country: 'RU', tz: 'Asia/Vladivostok', iata: ['VVO'], en: ['vladivostok'] },
  { name: '하바롭스크', country: 'RU', tz: 'Asia/Vladivostok', iata: ['KHV'], en: ['khabarovsk'] },

  // ---- 괌·사이판·호주 ----
  { name: '괌', country: 'GU', tz: 'Pacific/Guam', iata: ['GUM'], en: ['guam'] },
  { name: '사이판', country: 'MP', tz: 'Pacific/Saipan', iata: ['SPN'], en: ['saipan'], legacy: +1, stay: true },
  { name: '시드니', country: 'AU', tz: 'Australia/Sydney', iata: ['SYD'], en: ['sydney'], stay: true },

  // ---- 유럽 ----
  { name: '로마', country: 'IT', tz: 'Europe/Rome', iata: ['FCO'], aliases: ['피우미치노'], en: ['rome', 'roma'], legacy: -7, stay: true },
  { name: '파리', country: 'FR', tz: 'Europe/Paris', iata: ['CDG'], aliases: ['샤를드골'], en: ['paris'], legacy: -7, stay: true },
  { name: '바르셀로나', country: 'ES', tz: 'Europe/Madrid', iata: ['BCN'], en: ['barcelona'], legacy: -7, stay: true },
  { name: '프랑크푸르트', country: 'DE', tz: 'Europe/Berlin', iata: ['FRA'], en: ['frankfurt'], legacy: -7, stay: true },
  { name: '자그레브', country: 'HR', tz: 'Europe/Zagreb', iata: ['ZAG'], en: ['zagreb'], stay: true },

  // ---- 북미 ----
  { name: '밴쿠버', country: 'CA', tz: 'America/Vancouver', rule: { from: '2026-11-01', tz: 'Etc/GMT+7' }, iata: ['YVR'], aliases: ['벤쿠버'], en: ['vancouver'], legacy: -16, stay: true }
]);

/** 운영본(v1) 시차표에 있던 도시 순서 (호환 확인용) */
export const LEGACY_CITY_ORDER = Object.freeze([
  '비슈케크', '자카르타', '방콕', '치앙마이', '다낭', '나트랑', '푸꾸옥', '싱가포르', '홍콩', '타이베이', '타이중', '가오슝',
  '울란바토르', '선양', '우한', '로마', '파리', '바르셀로나', '프랑크푸르트', '밴쿠버', '사이판'
]);

/** 달력 칸 근무명·코드와 겹치면 안 되는 3글자 (IATA 로 오인 금지) */
export const NON_AIRPORT_WORDS = Object.freeze(['SBY', 'OFF', 'ISA', 'ISB', 'ISC', 'ISD', 'GSA', 'GSB', 'GSC', 'GSD', 'KST', 'UTC', 'GMT', 'OAL', 'DHD', 'TWB']);

// ---- 색인 ----
const BY_IATA = new Map();
const NAME_INDEX = []; // [표기, place] — 긴 표기부터
for (const p of PLACES) {
  for (const c of p.iata) BY_IATA.set(c, p);
  for (const n of [p.name, ...(p.aliases || [])]) NAME_INDEX.push([n, p]);
  for (const n of p.en || []) NAME_INDEX.push([n.toLowerCase(), p]);
}
NAME_INDEX.sort((a, b) => b[0].length - a[0].length);

/** IATA 공항코드 → 장소 (없으면 null) */
export function placeByIata(code) {
  return BY_IATA.get(String(code || '').trim().toUpperCase()) || null;
}

/**
 * 목적지 문자열 → 장소. 예) '시드니' · 'SYD' · '오사카/간사이' · '나트랑(캄란)' · '비슈케크 (마나스)' · 'Sydney'
 *  - 여러 개가 걸리면 한국 밖 장소를 우선 ('ICN-SYD' → 시드니), 그다음 긴 표기 우선 ('제주체류' → 제주)
 *  - 못 찾으면 null
 */
export function findPlace(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const hits = [];
  for (const [n, p] of NAME_INDEX) {
    if ((/[a-z]/.test(n) ? lower : s).includes(n)) hits.push({ p, len: n.length });
  }
  for (const m of s.toUpperCase().matchAll(/(?<![A-Z])([A-Z]{3})(?![A-Z])/g)) {
    const p = BY_IATA.get(m[1]);
    if (p && !NON_AIRPORT_WORDS.includes(m[1])) hits.push({ p, len: 3 });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => (a.p.country === 'KR') - (b.p.country === 'KR') || b.len - a.len);
  return hits[0].p;
}

/** 그 날짜에 쓸 IANA 시간대 (rule 반영). dateKey 'YYYY-MM-DD' */
export function placeZone(place, dateKey) {
  if (!place) return null;
  if (place.rule && dateKey && dateKey >= place.rule.from) return place.rule.tz;
  return place.tz;
}

/** 체류 비행지인가 (운영본 판정 목록 + 장거리) — 표기·별칭 포함 */
export const STAY_WORDS = Object.freeze([
  ...PLACES.filter(p => p.stay).flatMap(p => (p.country === 'KR' ? [p.name] : [p.name, ...(p.aliases || [])])), // 국내는 운영본처럼 도시명만 ('김해' 퀵턴 오인 방지)
  '제주체류'
]);
