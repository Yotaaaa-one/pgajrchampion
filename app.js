
(function () {
  'use strict';

  const STORAGE_KEY = 'jrTeamScoreV2.data';
  const VERSION = '2.1.0-firebase-nested-array-fix';
  const DEVICE_KEY = 'jrTeamScoreV2.device';
  const REGIONS = [
    { id: 'chugoku', name: '中国地区', block: 'A', color: '蛍光ピンク' },
    { id: 'chubu', name: '中部地区', block: 'A', color: 'ライトグリーン' },
    { id: 'kyushu', name: '九州地区', block: 'A', color: '蛍光イエロー' },
    { id: 'hokkaido', name: '北海道地区', block: 'A', color: 'パープル' },
    { id: 'kanto', name: '関東地区', block: 'B', color: 'ダークグレー' },
    { id: 'kansai', name: '関西地区', block: 'B', color: 'ミントブルー' },
    { id: 'tohoku', name: '東北地区', block: 'B', color: 'ブラック' },
    { id: 'shikoku', name: '四国地区', block: 'B', color: '蛍光オレンジ' }
  ];
  const DEFAULT_PAR = [5,4,4,3,5,3,4,4,4,5,3,4,4,3,4,4,4,4];


  const syncState = {
    initialized: false,
    enabled: false,
    db: null,
    docRef: null,
    unsubscribe: null,
    callbacks: [],
    lastSource: 'local',
    error: '',
    writing: false
  };

  function firebaseConfigReady() {
    const cfg = window.JR_FIREBASE_CONFIG || {};
    return !!(cfg.enabled && cfg.apiKey && cfg.projectId && window.firebase && firebase.firestore);
  }

  function getTournamentId() {
    return window.JR_TOURNAMENT_ID || 'junior2026';
  }

  function getFirestoreCollection() {
    return window.JR_FIRESTORE_COLLECTION || 'junior_tournaments';
  }

  function initFirebaseSync() {
    if (syncState.initialized) return syncState;
    syncState.initialized = true;
    if (!firebaseConfigReady()) {
      syncState.enabled = false;
      syncState.error = (window.JR_FIREBASE_CONFIG && window.JR_FIREBASE_CONFIG.enabled)
        ? 'Firebase SDKまたはconfigが未設定です。'
        : 'FirebaseはOFFです。firebase-config.jsでenabled:trueにすると同期します。';
      return syncState;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(window.JR_FIREBASE_CONFIG);
      }
      syncState.db = firebase.firestore();
      syncState.docRef = syncState.db.collection(getFirestoreCollection()).doc(getTournamentId());
      syncState.enabled = true;
      syncState.error = '';
      syncState.unsubscribe = syncState.docRef.onSnapshot(snapshot => {
        if (!snapshot.exists) {
          const current = loadData();
          saveData(current, { skipNotify: true });
          return;
        }
        const payload = snapshot.data() || {};
        if (!payload.data) return;
        const remote = normalizeData(decodeFirestoreValue(payload.data));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
        syncState.lastSource = 'firebase';
        notifyDataChanged(remote, 'firebase');
      }, err => {
        console.warn('Firebase同期エラー', err);
        syncState.error = err.message || String(err);
        notifySyncChanged();
      });
    } catch (err) {
      console.warn('Firebase初期化エラー', err);
      syncState.enabled = false;
      syncState.error = err.message || String(err);
    }
    notifySyncChanged();
    return syncState;
  }

  function writeFirebase(data) {
    initFirebaseSync();
    if (!syncState.enabled || !syncState.docRef) return;
    const payload = {
      tournamentId: getTournamentId(),
      version: VERSION,
      data: encodeFirestoreValue(clone(data)),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtLocal: new Date().toISOString()
    };
    syncState.writing = true;
    syncState.docRef.set(payload, { merge: true }).then(() => {
      syncState.writing = false;
      syncState.error = '';
      notifySyncChanged();
    }).catch(err => {
      syncState.writing = false;
      syncState.error = err.message || String(err);
      console.warn('Firebase保存エラー', err);
      notifySyncChanged();
    });
  }

  function notifyDataChanged(data, source) {
    syncState.callbacks.forEach(cb => {
      if (cb.type === 'data') {
        try { cb.fn(data, source); } catch (err) { console.warn(err); }
      }
    });
  }

  function notifySyncChanged() {
    syncState.callbacks.forEach(cb => {
      if (cb.type === 'sync') {
        try { cb.fn(getSyncStatus()); } catch (err) { console.warn(err); }
      }
    });
  }

  function onDataChanged(fn) {
    const item = { type: 'data', fn };
    syncState.callbacks.push(item);
    return () => { syncState.callbacks = syncState.callbacks.filter(x => x !== item); };
  }

  function onSyncChanged(fn) {
    const item = { type: 'sync', fn };
    syncState.callbacks.push(item);
    return () => { syncState.callbacks = syncState.callbacks.filter(x => x !== item); };
  }

  function getSyncStatus() {
    initFirebaseSync();
    return {
      enabled: syncState.enabled,
      initialized: syncState.initialized,
      tournamentId: getTournamentId(),
      collection: getFirestoreCollection(),
      writing: syncState.writing,
      error: syncState.error,
      source: syncState.lastSource
    };
  }

  function makePlayers(teamName) {
    return Array.from({ length: 16 }, (_, i) => ({
      name: `${teamName.replace('地区', '')}${i + 1}`,
      school: '',
      gender: i < 8 ? '女子' : '男子',
      category: i < 8 ? '中高女子' : '中高男子'
    }));
  }

  function defaultPairings() {
    return Array.from({ length: 8 }, (_, i) => [i * 2, i * 2 + 1]);
  }

  function createDefaultData() {
    const teams = REGIONS.map(region => ({
      id: region.id,
      name: region.name,
      block: region.block,
      color: region.color,
      players: makePlayers(region.name)
    }));
    const pairings = { round1: {}, final: {} };
    teams.forEach(team => {
      pairings.round1[team.id] = defaultPairings();
      pairings.final[team.id] = defaultPairings();
    });
    return {
      version: VERSION,
      meta: {
        title: 'PGAジュニア チーム戦スコア速報ターミナル',
        competitionName: 'PGAジュニアゴルフ選手権大会',
        venue: '太平洋クラブ益子PGAコース',
        date1: '',
        date2: '',
        parByHole: DEFAULT_PAR.slice(),
        note: '1日目・2日目とも18ホールのスコアを入力。2日目のポイントは自動計算。'
      },
      teams,
      pairings,
      round1: { scores: {} },
      final: { scores: {} },
      updatedAt: new Date().toISOString()
    };
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }


  // Firestoreは「配列の中に配列」を保存できないため、同期時だけ配列をMap形式に変換する。
  // 画面側・localStorage側では従来どおり配列として扱う。
  const FIRESTORE_ARRAY_MARKER = '__jrArray';

  function encodeFirestoreValue(value) {
    if (Array.isArray(value)) {
      const items = {};
      value.forEach((item, index) => {
        items[String(index)] = encodeFirestoreValue(item);
      });
      return { [FIRESTORE_ARRAY_MARKER]: true, items };
    }
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(key => {
        if (typeof value[key] !== 'undefined') {
          out[key] = encodeFirestoreValue(value[key]);
        }
      });
      return out;
    }
    return value;
  }

  function decodeFirestoreValue(value) {
    if (value && typeof value === 'object' && value[FIRESTORE_ARRAY_MARKER] === true) {
      const items = value.items || {};
      return Object.keys(items)
        .sort((a, b) => Number(a) - Number(b))
        .map(key => decodeFirestoreValue(items[key]));
    }
    if (Array.isArray(value)) {
      return value.map(decodeFirestoreValue);
    }
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(key => {
        out[key] = decodeFirestoreValue(value[key]);
      });
      return out;
    }
    return value;
  }

  function loadData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    let data;
    if (!raw) {
      data = createDefaultData();
      saveData(data);
      return data;
    }
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('保存データを読み込めません。初期化します。', err);
      data = createDefaultData();
    }
    return normalizeData(data);
  }

  function normalizeData(data) {
    const def = createDefaultData();
    data.version = data.version || VERSION;
    data.meta = Object.assign({}, def.meta, data.meta || {});
    if (!Array.isArray(data.meta.parByHole) || data.meta.parByHole.length !== 18) {
      data.meta.parByHole = DEFAULT_PAR.slice();
    }
    data.teams = Array.isArray(data.teams) && data.teams.length ? data.teams : def.teams;
    data.teams.forEach((team, idx) => {
      const fallback = REGIONS[idx] || REGIONS[0];
      team.id = team.id || fallback.id || `team_${idx+1}`;
      team.name = team.name || fallback.name || `チーム${idx+1}`;
      team.block = team.block || fallback.block || (idx < 4 ? 'A' : 'B');
      team.color = team.color || fallback.color || '';
      team.players = Array.isArray(team.players) ? team.players : makePlayers(team.name);
      while (team.players.length < 16) {
        team.players.push({ name: `${team.name}${team.players.length + 1}`, school: '', gender: team.players.length < 8 ? '女子' : '男子', category: '' });
      }
      team.players = team.players.slice(0, 16).map((p, pidx) => ({
        name: p.name || `${team.name.replace('地区', '')}${pidx + 1}`,
        school: p.school || '',
        gender: p.gender || (pidx < 8 ? '女子' : '男子'),
        category: p.category || (pidx < 8 ? '中高女子' : '中高男子')
      }));
    });
    data.pairings = data.pairings || { round1: {}, final: {} };
    data.pairings.round1 = data.pairings.round1 || {};
    data.pairings.final = data.pairings.final || {};
    data.teams.forEach(team => {
      ['round1', 'final'].forEach(day => {
        if (!Array.isArray(data.pairings[day][team.id]) || data.pairings[day][team.id].length !== 8) {
          data.pairings[day][team.id] = defaultPairings();
        }
        data.pairings[day][team.id] = data.pairings[day][team.id].map((pair, i) => {
          if (!Array.isArray(pair) || pair.length < 2) return [i * 2, i * 2 + 1];
          return [clampInt(pair[0], 0, 15), clampInt(pair[1], 0, 15)];
        });
      });
    });
    data.round1 = data.round1 || { scores: {} };
    data.round1.scores = data.round1.scores || {};
    data.final = data.final || { scores: {} };
    data.final.scores = data.final.scores || {};
    data.confirmations = data.confirmations || { round1: {}, final: {} };
    data.confirmations.round1 = data.confirmations.round1 || {};
    data.confirmations.final = data.confirmations.final || {};
    return data;
  }

  function saveData(data, options = {}) {
    data.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!options.skipFirebase) writeFirebase(data);
    if (!options.skipNotify) notifyDataChanged(data, 'local');
  }

  function resetData() {
    const data = createDefaultData();
    saveData(data);
    return data;
  }

  function importData(jsonText) {
    const parsed = normalizeData(JSON.parse(jsonText));
    saveData(parsed);
    return parsed;
  }

  function getTeam(data, teamId) {
    return data.teams.find(t => t.id === teamId);
  }

  function clampInt(value, min, max) {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function scoreValue(value) {
    if (value === '' || value === null || typeof value === 'undefined') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 && n <= 20 ? n : null;
  }

  function normalizeScoreArray(values) {
    const arr = Array.isArray(values) ? values : [];
    return Array.from({ length: 18 }, (_, i) => scoreValue(arr[i]));
  }

  function formatNum(n, empty = '-') {
    return Number.isFinite(n) ? String(n) : empty;
  }

  function sumScores(scores, start = 0, end = 18) {
    const arr = normalizeScoreArray(scores).slice(start, end);
    if (arr.some(v => v === null)) return null;
    return arr.reduce((a, b) => a + b, 0);
  }

  function partialSum(scores, start = 0, end = 18) {
    const arr = normalizeScoreArray(scores).slice(start, end).filter(v => v !== null);
    return arr.length ? arr.reduce((a, b) => a + b, 0) : null;
  }

  function completedHoles(scores) {
    return normalizeScoreArray(scores).filter(v => v !== null).length;
  }

  function getPair(data, teamId, day, pairIndex) {
    const team = getTeam(data, teamId);
    if (!team) return { indexes: [0, 1], players: [], label: '' };
    const source = data.pairings?.[day]?.[teamId] || defaultPairings();
    const indexes = source[pairIndex] || [pairIndex * 2, pairIndex * 2 + 1];
    const players = indexes.map(i => team.players[i]).filter(Boolean);
    const label = players.map(p => p.name || '未登録').join(' / ');
    const schools = players.map(p => p.school).filter(Boolean).join(' / ');
    return { indexes, players, label, schools };
  }

  function setRound1Scores(data, teamId, pairIndex, scores) {
    data.round1.scores[teamId] = data.round1.scores[teamId] || [];
    data.round1.scores[teamId][pairIndex] = normalizeScoreArray(scores);
  }

  function getRound1Scores(data, teamId, pairIndex) {
    return normalizeScoreArray(data.round1?.scores?.[teamId]?.[pairIndex]);
  }

  function teamGrandTotal(data, teamId) {
    let total = 0;
    let complete = true;
    for (let i = 0; i < 8; i++) {
      const pairTotal = sumScores(getRound1Scores(data, teamId, i));
      if (pairTotal === null) complete = false;
      total += pairTotal || 0;
    }
    return complete ? total : null;
  }

  function teamProgress(data, teamId) {
    let holes = 0;
    for (let i = 0; i < 8; i++) holes += completedHoles(getRound1Scores(data, teamId, i));
    return holes;
  }

  function birdiesOnHole(data, teamId, holeIndex) {
    const par = Number(data.meta.parByHole[holeIndex]) || DEFAULT_PAR[holeIndex];
    let count = 0;
    for (let i = 0; i < 8; i++) {
      const s = getRound1Scores(data, teamId, i)[holeIndex];
      if (s !== null && s < par) count += 1;
    }
    return count;
  }

  function rankTeamsInBlock(data, block) {
    const teams = data.teams.filter(t => t.block === block);
    const ranked = teams.map(team => ({
      team,
      total: teamGrandTotal(data, team.id),
      progress: teamProgress(data, team.id),
      birdies: Array.from({ length: 18 }, (_, i) => birdiesOnHole(data, team.id, i))
    }));
    ranked.sort((a, b) => {
      const at = a.total === null ? Infinity : a.total;
      const bt = b.total === null ? Infinity : b.total;
      if (at !== bt) return at - bt;
      for (let h = 17; h >= 0; h--) {
        if (a.birdies[h] !== b.birdies[h]) return b.birdies[h] - a.birdies[h];
      }
      return a.team.name.localeCompare(b.team.name, 'ja');
    });
    return ranked.map((row, i) => ({ ...row, rank: i + 1 }));
  }

  function getFinalMatches(data) {
    const a = rankTeamsInBlock(data, 'A');
    const b = rankTeamsInBlock(data, 'B');
    const fallbackA = data.teams.filter(t => t.block === 'A').map((team, i) => ({ team, rank: i+1 }));
    const fallbackB = data.teams.filter(t => t.block === 'B').map((team, i) => ({ team, rank: i+1 }));
    const ar = a.length ? a : fallbackA;
    const br = b.length ? b : fallbackB;
    const defs = [
      { key: 'championship', title: '決勝戦', leftRank: 'Aブロック1位', rightRank: 'Bブロック1位', winnerRank: '優勝', loserRank: '2位' },
      { key: 'third', title: '3位・4位決定戦', leftRank: 'Aブロック2位', rightRank: 'Bブロック2位', winnerRank: '3位', loserRank: '4位' },
      { key: 'fifth', title: '5位・6位決定戦', leftRank: 'Aブロック3位', rightRank: 'Bブロック3位', winnerRank: '5位', loserRank: '6位' },
      { key: 'seventh', title: '7位・8位決定戦', leftRank: 'Aブロック4位', rightRank: 'Bブロック4位', winnerRank: '7位', loserRank: '8位' }
    ];
    return defs.map((def, i) => ({
      ...def,
      leftTeamId: ar[i]?.team?.id || null,
      rightTeamId: br[i]?.team?.id || null,
      leftTeam: ar[i]?.team || null,
      rightTeam: br[i]?.team || null
    }));
  }

  function getFinalScores(data, matchKey, teamId, pairIndex) {
    return normalizeScoreArray(data.final?.scores?.[matchKey]?.[teamId]?.[pairIndex]);
  }

  function setFinalScores(data, matchKey, teamId, pairIndex, scores) {
    data.final.scores[matchKey] = data.final.scores[matchKey] || {};
    data.final.scores[matchKey][teamId] = data.final.scores[matchKey][teamId] || [];
    data.final.scores[matchKey][teamId][pairIndex] = normalizeScoreArray(scores);
  }

  function pointsForScores(leftScores, rightScores) {
    const l = normalizeScoreArray(leftScores);
    const r = normalizeScoreArray(rightScores);
    const leftPts = [];
    const rightPts = [];
    for (let i = 0; i < 18; i++) {
      if (l[i] === null || r[i] === null) {
        leftPts.push(null);
        rightPts.push(null);
      } else if (l[i] < r[i]) {
        leftPts.push(3); rightPts.push(0);
      } else if (l[i] > r[i]) {
        leftPts.push(0); rightPts.push(3);
      } else {
        leftPts.push(1); rightPts.push(1);
      }
    }
    return { leftPts, rightPts };
  }

  function sumPoints(points) {
    return points.filter(v => v !== null).reduce((a, b) => a + b, 0);
  }

  function calcFinalMatch(data, match) {
    const rows = [];
    let leftPoints = 0, rightPoints = 0;
    let leftStroke = 0, rightStroke = 0;
    let leftStrokeComplete = true, rightStrokeComplete = true;
    for (let i = 0; i < 8; i++) {
      const leftScores = getFinalScores(data, match.key, match.leftTeamId, i);
      const rightScores = getFinalScores(data, match.key, match.rightTeamId, i);
      const pt = pointsForScores(leftScores, rightScores);
      const lp = sumPoints(pt.leftPts);
      const rp = sumPoints(pt.rightPts);
      const lt = sumScores(leftScores);
      const rt = sumScores(rightScores);
      if (lt === null) leftStrokeComplete = false;
      if (rt === null) rightStrokeComplete = false;
      leftStroke += lt || 0;
      rightStroke += rt || 0;
      leftPoints += lp;
      rightPoints += rp;
      rows.push({
        pairIndex: i,
        leftPair: getPair(data, match.leftTeamId, 'final', i),
        rightPair: getPair(data, match.rightTeamId, 'final', i),
        leftScores,
        rightScores,
        leftPts: pt.leftPts,
        rightPts: pt.rightPts,
        leftPointTotal: lp,
        rightPointTotal: rp,
        leftOut: sumScores(leftScores, 0, 9),
        leftIn: sumScores(leftScores, 9, 18),
        leftTotal: lt,
        rightOut: sumScores(rightScores, 0, 9),
        rightIn: sumScores(rightScores, 9, 18),
        rightTotal: rt
      });
    }
    const result = determineMatchWinner(match, rows, leftPoints, rightPoints, leftStrokeComplete ? leftStroke : null, rightStrokeComplete ? rightStroke : null);
    return { rows, leftPoints, rightPoints, leftStroke: leftStrokeComplete ? leftStroke : null, rightStroke: rightStrokeComplete ? rightStroke : null, result };
  }

  function determineMatchWinner(match, rows, leftPoints, rightPoints, leftStroke, rightStroke) {
    if (!match.leftTeam || !match.rightTeam) return { status: 'empty', message: '対戦未生成' };
    if (leftPoints > rightPoints) return { status: 'win', winnerSide: 'left', winner: match.leftTeam, loser: match.rightTeam, method: 'ポイント' };
    if (rightPoints > leftPoints) return { status: 'win', winnerSide: 'right', winner: match.rightTeam, loser: match.leftTeam, method: 'ポイント' };
    if (match.key === 'championship') {
      return { status: 'playoff', message: '決勝戦はポイント同点のためプレーオフ判定が必要' };
    }
    if (leftStroke !== null && rightStroke !== null) {
      if (leftStroke < rightStroke) return { status: 'win', winnerSide: 'left', winner: match.leftTeam, loser: match.rightTeam, method: 'Totalストローク' };
      if (rightStroke < leftStroke) return { status: 'win', winnerSide: 'right', winner: match.rightTeam, loser: match.leftTeam, method: 'Totalストローク' };
      const leftTotals = rows.map(r => r.leftTotal).filter(v => v !== null).sort((a,b)=>a-b);
      const rightTotals = rows.map(r => r.rightTotal).filter(v => v !== null).sort((a,b)=>a-b);
      if (leftTotals.length === 8 && rightTotals.length === 8) {
        for (let i = 0; i < 8; i++) {
          if (leftTotals[i] < rightTotals[i]) return { status: 'win', winnerSide: 'left', winner: match.leftTeam, loser: match.rightTeam, method: 'スコアマッチング' };
          if (rightTotals[i] < leftTotals[i]) return { status: 'win', winnerSide: 'right', winner: match.rightTeam, loser: match.leftTeam, method: 'スコアマッチング' };
        }
      }
    }
    return { status: 'tie', message: '同点。競技委員会判定が必要' };
  }

  function finalRanking(data) {
    const matches = getFinalMatches(data);
    const slots = [];
    matches.forEach(match => {
      const calc = calcFinalMatch(data, match);
      if (calc.result.status === 'win') {
        slots.push({ rank: match.winnerRank, team: calc.result.winner, method: calc.result.method });
        slots.push({ rank: match.loserRank, team: calc.result.loser, method: calc.result.method });
      } else {
        slots.push({ rank: match.winnerRank, team: null, method: calc.result.message || '未確定' });
        slots.push({ rank: match.loserRank, team: null, method: calc.result.message || '未確定' });
      }
    });
    return slots;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function holeHeaders() {
    return Array.from({ length: 18 }, (_, i) => `<th>${i + 1}</th>`).join('');
  }

  function parCells(data) {
    return data.meta.parByHole.map(p => `<td>${p}</td>`).join('');
  }

  function scoreInputs(scores, prefix = 'score') {
    const arr = normalizeScoreArray(scores);
    return arr.map((v, i) => `<td class="hole-input-cell"><input class="score-input" inputmode="numeric" pattern="[0-9]*" min="1" max="20" id="${prefix}_${i}" value="${v ?? ''}" aria-label="${i + 1}番ホール"></td>`).join('');
  }

  function readScoreInputs(prefix = 'score') {
    return Array.from({ length: 18 }, (_, i) => scoreValue(document.getElementById(`${prefix}_${i}`)?.value));
  }

  function csvEscape(v) {
    const text = String(v ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadText(filename, text, type = 'text/plain') {
    const bom = '\uFEFF';
    const blob = new Blob([bom + text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function buildRound1CSV(data) {
    const rows = [['ブロック','順位','地区名','ペア','選手名','学校名','OUT','IN','TOTAL','GRAND TOTAL','入力済み']];
    ['A','B'].forEach(block => {
      rankTeamsInBlock(data, block).forEach(rank => {
        const grand = teamGrandTotal(data, rank.team.id);
        for (let i = 0; i < 8; i++) {
          const pair = getPair(data, rank.team.id, 'round1', i);
          const s = getRound1Scores(data, rank.team.id, i);
          rows.push([
            block,
            rank.rank,
            rank.team.name,
            i + 1,
            pair.label,
            pair.schools,
            formatNum(sumScores(s, 0, 9)),
            formatNum(sumScores(s, 9, 18)),
            formatNum(sumScores(s)),
            grand ?? '',
            `${completedHoles(s)}/18`
          ]);
        }
      });
    });
    return rows.map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function buildFinalCSV(data) {
    const rows = [['対戦','地区L','地区R','ペア','選手L','OUT_L','IN_L','TOTAL_L','PT_L','PT_R','選手R','OUT_R','IN_R','TOTAL_R','勝敗']];
    getFinalMatches(data).forEach(match => {
      const calc = calcFinalMatch(data, match);
      calc.rows.forEach(row => {
        rows.push([
          match.title,
          match.leftTeam?.name || '',
          match.rightTeam?.name || '',
          row.pairIndex + 1,
          row.leftPair.label,
          formatNum(row.leftOut),
          formatNum(row.leftIn),
          formatNum(row.leftTotal),
          row.leftPointTotal,
          row.rightPointTotal,
          row.rightPair.label,
          formatNum(row.rightOut),
          formatNum(row.rightIn),
          formatNum(row.rightTotal),
          calc.result.status === 'win' ? `${calc.result.winner.name}勝利` : (calc.result.message || '未確定')
        ]);
      });
    });
    return rows.map(row => row.map(csvEscape).join(',')).join('\n');
  }


  function getDeviceAssignment() {
    try {
      const raw = localStorage.getItem(DEVICE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('端末設定を読み込めません。', err);
      return null;
    }
  }

  function setDeviceAssignment(assignment) {
    const normalized = Object.assign({
      locked: true,
      createdAt: new Date().toISOString(),
      inputterName: ''
    }, assignment || {});
    localStorage.setItem(DEVICE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function clearDeviceAssignment() {
    localStorage.removeItem(DEVICE_KEY);
  }

  function ensureConfirmationRoot(data) {
    data.confirmations = data.confirmations || { round1: {}, final: {} };
    data.confirmations.round1 = data.confirmations.round1 || {};
    data.confirmations.final = data.confirmations.final || {};
  }

  function defaultConfirmation() {
    return {
      savedAt: '',
      inputterName: '',
      companionConfirmed: false,
      companionConfirmedAt: '',
      hqConfirmed: false,
      hqConfirmedAt: '',
      note: ''
    };
  }

  function getConfirmation(data, kind, key1, key2) {
    ensureConfirmationRoot(data);
    const root = data.confirmations[kind] || {};
    const current = root[key1]?.[key2];
    return Object.assign(defaultConfirmation(), current || {});
  }

  function updateConfirmation(data, kind, key1, key2, patch) {
    ensureConfirmationRoot(data);
    data.confirmations[kind] = data.confirmations[kind] || {};
    data.confirmations[kind][key1] = data.confirmations[kind][key1] || {};
    const current = getConfirmation(data, kind, key1, key2);
    data.confirmations[kind][key1][key2] = Object.assign(current, patch || {});
    return data.confirmations[kind][key1][key2];
  }

  function confirmationStatus(conf) {
    const c = Object.assign(defaultConfirmation(), conf || {});
    if (c.hqConfirmed) return { label: '本部確認済み', className: 'status-hq' };
    if (c.companionConfirmed) return { label: '同伴確認済み', className: 'status-companion' };
    if (c.savedAt) return { label: '保存済み', className: 'status-saved' };
    return { label: '未保存', className: 'status-empty' };
  }

  function isScoresComplete(scores) {
    return completedHoles(scores) === 18;
  }

  function deviceModeLabel(mode) {
    if (mode === 'round1') return '1日目 組端末';
    if (mode === 'final') return '2日目 順位決定戦端末';
    return '未設定';
  }

  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
  }

  function bindNavActive() {
    const current = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav a').forEach(a => {
      if (a.getAttribute('href') === current) a.classList.add('active');
    });
  }

  function renderSyncBadges(data) {
    const status = getSyncStatus();
    document.querySelectorAll('[data-sync-status]').forEach(el => {
      el.textContent = status.enabled ? `Firebase同期中：${status.tournamentId}` : 'ローカル保存中';
      el.className = status.enabled ? 'sync-badge online' : 'sync-badge offline';
      if (status.error) el.title = status.error;
    });
    document.querySelectorAll('[data-updated-at]').forEach(el => {
      el.textContent = data?.updatedAt ? new Date(data.updatedAt).toLocaleString('ja-JP') : '-';
    });
  }

  function initHeader() {
    bindNavActive();
    initFirebaseSync();
    const data = loadData();
    const title = document.querySelector('[data-app-title]');
    if (title) title.textContent = data.meta.title;
    renderSyncBadges(data);
    onDataChanged(next => renderSyncBadges(next));
    onSyncChanged(() => renderSyncBadges(loadData()));
  }

  window.JR = {
    VERSION,
    STORAGE_KEY,
    DEVICE_KEY,
    REGIONS,
    DEFAULT_PAR,
    createDefaultData,
    loadData,
    saveData,
    resetData,
    importData,
    encodeFirestoreValue,
    decodeFirestoreValue,
    getTeam,
    scoreValue,
    normalizeScoreArray,
    formatNum,
    sumScores,
    partialSum,
    completedHoles,
    getPair,
    getRound1Scores,
    setRound1Scores,
    teamGrandTotal,
    teamProgress,
    birdiesOnHole,
    rankTeamsInBlock,
    getFinalMatches,
    getFinalScores,
    setFinalScores,
    pointsForScores,
    sumPoints,
    calcFinalMatch,
    finalRanking,
    escapeHtml,
    holeHeaders,
    parCells,
    scoreInputs,
    readScoreInputs,
    downloadText,
    buildRound1CSV,
    buildFinalCSV,
    getDeviceAssignment,
    setDeviceAssignment,
    clearDeviceAssignment,
    getConfirmation,
    updateConfirmation,
    confirmationStatus,
    isScoresComplete,
    deviceModeLabel,
    toast,
    initHeader,
    defaultPairings,
    initFirebaseSync,
    getSyncStatus,
    onDataChanged,
    onSyncChanged
  };

  document.addEventListener('DOMContentLoaded', initHeader);
})();
