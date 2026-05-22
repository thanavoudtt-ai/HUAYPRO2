/* ============================================================ */
/*  HUAYPLUS app.js — v3.0 clean build                         */
/* ============================================================ */

'use strict';

/* ── Config ─────────────────────────────────────────────────── */
// ⚠️ ใส่ URL จาก Google Apps Script deployment ของคุณตรงนี้
// วิธีหา: Google Apps Script → Deploy → Manage Deployments → Copy Web App URL
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbxdJZA_-N-U-9jXPxA0lycEnNkJglioE8eP85WHmOglSKYhX_RKIwY_87IuMb-w2van/exec';

/* ── App state ──────────────────────────────────────────────── */
let currentUser   = {};          // { username, name, role }
let sessionToken  = null;
let serverOffset  = 0;           // ms diff from server
let colorMode     = 'dark';
let huayType      = 'LAO';       // 'LAO' | 'THAI'
let checkType     = 'ALL';       // staff check win filter
let adminCheckType = 'ALL';      // admin check win filter
let currentBill   = [];          // [ { num, type, pos, price } ]
let _backTarget   = null;        // navbar back target
let _cancelBillId = null;        // pending cancel
let _editStaffId  = null;        // null = add, string = edit
let _t2focus      = 'top';       // thai2 modal focus side
let _t2pos        = 'TOP';       // thai2 selected position
let _clockTimer   = null;
let _warnedLao    = false;
let _warnedThai   = false;
let timeLimits    = { lao: '15:30', thai: '15:00' };

/* ── Page registry ──────────────────────────────────────────── */
const ALL_PAGES = [
  'recorderPage','dashboardPage','checkWinPage',
  'billHistoryPage','staffSettingsPage',
  'adminStaffPage','adminSalesPage','adminCheckPage','adminSettingsPage',
  'payoutPage','timeLimitPage','changePassPage','colorModePage','exportPage',
];

/* ════════════════════════════════════════════════════════════ */
/*  HELPERS                                                     */
/* ════════════════════════════════════════════════════════════ */

function $(id) { return document.getElementById(id); }

function getServerNow() {
  return new Date(Date.now() + serverOffset);
}

function fmtTime(d) {
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2,'0')).join(':');
}

function fmtDate(d) {
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString() + ' ₭';
}

function todayInputVal() {
  const n = getServerNow();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

/* API call */
async function api(body) {
  const res = await fetch(BACKEND_URL, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, token: sessionToken }),
  });
  return res.json();
}

/* ── Loading ─────────────────────────────────────────────────── */
function showLoading(msg = 'ກຳລັງໂຫລດ...') {
  $('loadingText').textContent = msg;
  $('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  $('loadingOverlay').classList.add('hidden');
}

/* ── Status modal ────────────────────────────────────────────── */
function showStatus(title, msg, type = 'success') {
  // type: 'success' | 'error' | 'warn'
  const icons = {
    success: '<polyline points="20 6 9 17 4 12"/>',
    error:   '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    warn:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>',
  };
  const icon = $('statusIcon');
  icon.className = `status-icon ${type}`;
  $('statusIconSvg').innerHTML = icons[type] || icons.success;
  $('statusTitle').textContent = title;
  $('statusMsg').textContent   = msg;
  $('statusModal').classList.remove('hidden');
}
function closeStatusModal(e) {
  if (!e || e.target === $('statusModal')) {
    $('statusModal').classList.add('hidden');
  }
}

/* ── Page navigation ─────────────────────────────────────────── */
function hideAllPages() {
  ALL_PAGES.forEach(id => {
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
}

function showPage(id) {
  const el = $(id);
  if (el) {
    el.classList.remove('hidden');
    // add animation class
    el.classList.remove('anim-fade');
    void el.offsetWidth; // reflow
    el.classList.add('anim-fade');
  }
}

function goToPage(id) {
  hideAllPages();
  showPage(id);
}

function showBackBtn(target) {
  _backTarget = target;
  $('backBtn').classList.remove('hidden');
}
function hideBackBtn() {
  _backTarget = null;
  $('backBtn').classList.add('hidden');
}

function navGoBack() {
  hideBackBtn();
  const t = _backTarget;
  if (!t || t === 'menu') {
    if (currentUser.role === 'superadmin') switchAdminTab('staff');
    else switchStaffTab('recorder');
  } else if (t === 'recorder')  { switchStaffTab('recorder'); }
  else if (t === 'check')       { switchStaffTab('check'); }
  else if (t === 'history')     { switchStaffTab('history'); }
  else if (t === 'admStaff')    { switchAdminTab('staff'); }
  else if (t === 'admSales')    { switchAdminTab('sales'); }
  else if (t === 'admCheck')    { switchAdminTab('check'); }
  else if (t === 'admSettings') { switchAdminTab('settings'); }
}

/* ── Dock ─────────────────────────────────────────────────────── */
function showDock(role) {
  $('staffDock').classList.add('hidden');
  $('adminDock').classList.add('hidden');
  if (role === 'staff')      $('staffDock').classList.remove('hidden');
  if (role === 'superadmin') $('adminDock').classList.remove('hidden');
}
function hideDock() {
  $('staffDock').classList.add('hidden');
  $('adminDock').classList.add('hidden');
}

function setDockActive(tabId) {
  document.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));
  const el = $(tabId);
  if (el) el.classList.add('active');
}

/* ─── Staff tab switching ────────────────────────────────────── */
function switchStaffTab(tab) {
  hideAllPages();
  hideBackBtn();
  if (tab === 'dashboard') {
    showPage('dashboardPage');
    setDockActive('staffTab_dashboard');
    loadDashboard();
  } else if (tab === 'history') {
    showPage('billHistoryPage');
    setDockActive('staffTab_history');
    loadBillHistory();
  } else if (tab === 'recorder') {
    showPage('recorderPage');
    setDockActive('staffTab_recorder');
    initRecorderPage();
  } else if (tab === 'check') {
    showPage('checkWinPage');
    setDockActive('staffTab_check');
    if (!$('checkDate').value) $('checkDate').value = todayInputVal();
  } else if (tab === 'settings') {
    showPage('staffSettingsPage');
    setDockActive('staffTab_settings');
  }
}

/* ─── Admin tab switching ────────────────────────────────────── */
function switchAdminTab(tab) {
  hideAllPages();
  hideBackBtn();
  if (tab === 'staff') {
    showPage('adminStaffPage');
    setDockActive('adminTab_staff');
    loadStaffList();
  } else if (tab === 'sales') {
    showPage('adminSalesPage');
    setDockActive('adminTab_sales');
    if (!$('adminBillDate').value) $('adminBillDate').value = todayInputVal();
    loadAdminSales();
  } else if (tab === 'check') {
    showPage('adminCheckPage');
    setDockActive('adminTab_check');
    if (!$('adminCheckDate').value) $('adminCheckDate').value = todayInputVal();
  } else if (tab === 'settings') {
    showPage('adminSettingsPage');
    setDockActive('adminTab_settings');
    loadTimeLimitSub();
  }
}

/* ─── Sub-page helpers ───────────────────────────────────────── */
function goToBillHistory() { switchStaffTab('history'); }
function goToDashboard()    { switchStaffTab('dashboard'); }
function goToRecorder()     { switchStaffTab('recorder'); }
function goToCheckWin()     { switchStaffTab('check'); }

function goToColorMode() {
  hideAllPages();
  showPage('colorModePage');
  showBackBtn(currentUser.role === 'superadmin' ? 'admSettings' : 'settings');
  updateColorModeUI();
}
function goToExportPage() {
  hideAllPages();
  showPage('exportPage');
  showBackBtn(currentUser.role === 'superadmin' ? 'admSettings' : 'settings');
  if (!$('exportFrom').value) $('exportFrom').value = todayInputVal();
  if (!$('exportTo').value)   $('exportTo').value   = todayInputVal();
}
function goToBillHistory() {
  hideAllPages();
  showPage('billHistoryPage');
  showBackBtn('menu');
  loadBillHistory();
}
function goToDashboard() {
  hideAllPages();
  showPage('dashboardPage');
  showBackBtn('menu');
  loadDashboard();
}
function goToRecorder() { switchStaffTab('recorder'); }
function goToCheckWin() { switchStaffTab('check'); }

/* ════════════════════════════════════════════════════════════ */
/*  LOGIN / LOGOUT                                              */
/* ════════════════════════════════════════════════════════════ */

let _pin = '';

function pinKey(d) {
  if (_pin.length >= 4) return;
  _pin += d;
  updatePinBoxes();
  if (_pin.length === 4) setTimeout(handleLogin, 120);
}
function pinDel() {
  _pin = _pin.slice(0, -1);
  updatePinBoxes();
}
function updatePinBoxes() {
  for (let i = 0; i < 4; i++) {
    const box = $(`pin${i}`);
    box.textContent = _pin[i] ? '●' : '';
    box.classList.toggle('filled',  i < _pin.length);
    box.classList.toggle('active',  i === _pin.length && _pin.length < 4);
  }
}

async function handleLogin() {
  const user = $('loginUser').value.trim();
  if (!user) { showLoginError('ກະລຸນາໃສ່ຊື່ຜູ້ໃຊ້'); return; }
  if (_pin.length < 4) { showLoginError('ກະລຸນາໃສ່ PIN 4 ຕົວ'); return; }

  // ตรวจ URL ยังเป็น placeholder
  if (BACKEND_URL.includes('YOUR_DEPLOYMENT_ID')) {
    showLoginError('ກະລຸນາຕັ້ງຄ່າ BACKEND_URL ໃນ app.js ກ່ອນ');
    return;
  }

  $('loginSubmitBtn').disabled = true;
  showLoading('ກຳລັງເຂົ້າສູ່ລະບົບ...');

  try {
    const data = await api({ action: 'login', username: user, pin: _pin });
    if (data.success) {
      sessionToken = data.token;
      serverOffset = (data.serverTime || Date.now()) - Date.now();
      currentUser  = { username: user, name: data.name || user, role: data.role };
      timeLimits   = data.timeLimits || timeLimits;
      hideLoading();
      startApp();
    } else {
      hideLoading();
      showLoginError(data.message || 'ຊື່ຜູ້ໃຊ້ ຫຼື PIN ບໍ່ຖືກຕ້ອງ');
      _pin = '';
      updatePinBoxes();
    }
  } catch(e) {
    hideLoading();
    showLoginError('ເຊື່ອມຕໍ່ລົ້ມເຫລວ — ກວດ URL ຫຼື Internet');
    _pin = '';
    updatePinBoxes();
  }
  $('loginSubmitBtn').disabled = false;
}

function showLoginError(msg) {
  $('loginError').textContent = msg;
  setTimeout(() => { $('loginError').textContent = ''; }, 3000);
}

function startApp() {
  $('loginPage').classList.add('hidden');
  $('mainApp').classList.remove('hidden');

  // Set navbar info
  $('navName').textContent = currentUser.name;
  $('navRole').textContent = currentUser.role === 'superadmin' ? '👑 Admin' : 'Staff Agent';

  // Start clock
  startClock();

  // Show dock and first page
  showDock(currentUser.role);
  if (currentUser.role === 'superadmin') {
    switchAdminTab('staff');
  } else {
    switchStaffTab('recorder'); // ✅ เปิดหน้าขายก่อนเลย
  }
}

function logout() {
  sessionToken = null;
  currentUser  = {};
  _pin         = '';
  currentBill  = [];
  if (_clockTimer) clearInterval(_clockTimer);

  hideDock();
  $('mainApp').classList.add('hidden');
  $('loginPage').classList.remove('hidden');

  // Reset login form
  $('loginUser').value = '';
  updatePinBoxes();
  $('loginError').textContent = '';
  $('loginUser').focus();
}

/* ════════════════════════════════════════════════════════════ */
/*  CLOCK                                                       */
/* ════════════════════════════════════════════════════════════ */

function startClock() {
  _clockTimer = setInterval(tickClock, 1000);
  tickClock();
}

function tickClock() {
  const now = getServerNow();
  $('navClock').textContent = fmtTime(now);
  checkNearClose(now);
}

function checkNearClose(now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  ['LAO','THAI'].forEach(type => {
    const limitStr = type === 'LAO' ? timeLimits.lao : timeLimits.thai;
    if (!limitStr) return;
    const [h, m] = limitStr.split(':').map(Number);
    const limitMins = h * 60 + m;
    const diff = limitMins - mins;
    const warned = type === 'LAO' ? _warnedLao : _warnedThai;
    if (diff === 15 && !warned) {
      if (type === 'LAO') _warnedLao = true; else _warnedThai = true;
      showStatus(`ໃກ້ໝົດເວລາ`, `ຫວຍ${type === 'LAO' ? 'ລາວ' : 'ໄທ'} ຈະປິດຮັບໃນ 15 ນາທີ (${limitStr})`, 'warn');
    }
    // Reset warn flag at midnight
    if (mins === 0) { _warnedLao = false; _warnedThai = false; }
  });
}

function isTimeClosed(type) {
  const now  = getServerNow();
  const mins = now.getHours() * 60 + now.getMinutes();
  const limitStr = type === 'LAO' ? timeLimits.lao : timeLimits.thai;
  if (!limitStr) return false;
  const [h, m] = limitStr.split(':').map(Number);
  return mins >= h * 60 + m;
}

/* ════════════════════════════════════════════════════════════ */
/*  COLOR MODE                                                  */
/* ════════════════════════════════════════════════════════════ */

function setColorMode(mode) {
  colorMode = mode;
  localStorage.setItem('colorMode', mode);
  applyColorMode(mode);
  updateColorModeUI();
}

function applyColorMode(mode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'auto' && prefersDark);

  const root = document.documentElement;
  if (isDark) {
    root.style.setProperty('--bg-base',    '#050e05');
    root.style.setProperty('--bg-surface', '#0a1a0a');
    root.style.setProperty('--bg-raised',  '#0f2210');
    root.style.setProperty('--bg-overlay', '#142814');
    root.style.setProperty('--text-1',     'rgba(255,255,255,0.93)');
    root.style.setProperty('--text-2',     'rgba(255,255,255,0.55)');
    root.style.setProperty('--text-3',     'rgba(255,255,255,0.28)');
    root.style.setProperty('--border-1',   'rgba(61,220,132,0.14)');
    root.style.setProperty('--border-2',   'rgba(255,255,255,0.08)');
    root.style.setProperty('--glass-fill', 'rgba(255,255,255,0.045)');
    document.body.style.background = '#050e05';
  } else {
    root.style.setProperty('--bg-base',    '#f0f5f0');
    root.style.setProperty('--bg-surface', '#ffffff');
    root.style.setProperty('--bg-raised',  '#f8faf8');
    root.style.setProperty('--bg-overlay', '#edf3ed');
    root.style.setProperty('--text-1',     '#0d1f0d');
    root.style.setProperty('--text-2',     'rgba(15,40,15,0.55)');
    root.style.setProperty('--text-3',     'rgba(15,40,15,0.35)');
    root.style.setProperty('--border-1',   'rgba(34,197,94,0.25)');
    root.style.setProperty('--border-2',   'rgba(34,197,94,0.15)');
    root.style.setProperty('--glass-fill', 'rgba(255,255,255,0.7)');
    document.body.style.background = '#f0f5f0';
  }
}

function updateColorModeUI() {
  ['light','dark','auto'].forEach(m => {
    const el = $(`colorMode${m.charAt(0).toUpperCase() + m.slice(1)}`);
    if (el) {
      el.style.borderColor = colorMode === m ? 'rgba(61,220,132,0.5)' : '';
      el.style.background  = colorMode === m ? 'rgba(61,220,132,0.07)' : '';
    }
  });
}

/* ════════════════════════════════════════════════════════════ */
/*  STAFF: RECORDER                                             */
/* ════════════════════════════════════════════════════════════ */

function initRecorderPage() {
  currentBill = [];
  renderBillTable();
  $('huayNum').value    = '';
  $('huayAmt').value    = '';
  $('customerName').value = '';
  setHuayType('LAO');
  setTimeout(() => $('huayNum').focus(), 100);
}

function setHuayType(type) {
  huayType = type;
  $('typeLao').classList.toggle('active',  type === 'LAO');
  $('typeThai').classList.toggle('active', type === 'THAI');
}

function setCheckType(type) {
  checkType = type;
  ['ALL','LAO','THAI'].forEach(t => {
    $(`checkTyp${t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}`).classList.toggle('active', type === t);
  });
}

function setAdminCheckType(type) {
  adminCheckType = type;
  ['ALL','LAO','THAI'].forEach(t => {
    const suffix = t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase();
    $(`admChk${suffix}`).classList.toggle('active', type === t);
  });
}

function addAmt(n) {
  const cur = parseFloat($('huayAmt').value) || 0;
  $('huayAmt').value = cur + n;
}

function addItemToBill() {
  const num = $('huayNum').value.trim();
  const amt = parseFloat($('huayAmt').value) || 0;

  if (!num || !/^\d{2,3}$/.test(num)) {
    showStatus('ຂໍ້ຜິດພາດ', 'ກະລຸນາໃສ່ເລກ 2-3 ຕົວເລກ', 'error'); return;
  }
  if (amt <= 0) {
    showStatus('ຂໍ້ຜິດພາດ', 'ກະລຸນາໃສ່ຈຳນວນເງິນ', 'error'); return;
  }

  // Check time limit
  if (isTimeClosed(huayType)) {
    const limit = huayType === 'LAO' ? timeLimits.lao : timeLimits.thai;
    $('timeLimitMsg').textContent = `ຫວຍ${huayType === 'LAO' ? 'ລາວ' : 'ໄທ'} ປິດຮັບເວລາ ${limit}`;
    $('timeLimitModal').classList.remove('hidden');
    return;
  }

  // Thai 2-digit → open position modal
  if (huayType === 'THAI' && num.length === 2) {
    openThai2Modal(num, amt);
    return;
  }

  // Add directly (Lao 2/3, Thai 3)
  currentBill.unshift({
    num, type: huayType,
    pos: 'ALL',
    price: amt,
  });
  renderBillTable();
  $('huayNum').value = '';
  $('huayAmt').value = '';
  $('huayNum').focus();
}

function removeBillItem(idx) {
  currentBill.splice(idx, 1);
  renderBillTable();
}

function clearBill() {
  if (currentBill.length === 0) return;
  currentBill = [];
  renderBillTable();
}

function renderBillTable() {
  const tbody  = $('billBody');
  const empty  = $('billEmpty');
  const count  = $('billCount');
  const total  = $('billTotal');

  if (currentBill.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    count.textContent   = '0 ລາຍການ';
    total.textContent   = '0 ₭';
    return;
  }

  empty.style.display = 'none';
  count.textContent   = `${currentBill.length} ລາຍການ`;

  const posLabel = { ALL: '—', TOP: 'ເທິງ', BOT: 'ລຸ່ມ' };
  tbody.innerHTML = currentBill.map((item, i) => `
    <tr>
      <td style="font-size:18px; font-weight:700; letter-spacing:3px; color:var(--accent);">${item.num}</td>
      <td><span class="badge badge-green" style="font-size:10px;">${item.type}</span></td>
      <td style="font-size:12px; color:var(--text-2);">${posLabel[item.pos] || item.pos}</td>
      <td style="text-align:right; font-weight:600;">${Number(item.price).toLocaleString()}</td>
      <td>
        <button onclick="removeBillItem(${i})" style="background:none; border:none; cursor:pointer; padding:4px 6px; color:var(--danger); font-size:16px; line-height:1;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');

  const sum = currentBill.reduce((acc, i) => acc + i.price, 0);
  total.textContent = fmtMoney(sum);
}

async function saveBill() {
  if (currentBill.length === 0) {
    showStatus('ຂໍ້ຜິດພາດ', 'ກະລຸນາເພີ່ມລາຍການກ່ອນ', 'error'); return;
  }

  showLoading('ກຳລັງບັນທຶກ...');
  try {
    const data = await api({
      action: 'saveBill',
      username: currentUser.username,
      staffName: currentUser.name,
      customer: $('customerName').value.trim(),
      items: currentBill,
      total: currentBill.reduce((a, i) => a + i.price, 0),
      huayType,
    });

    hideLoading();
    if (data.success) {
      openSlipModal(data.bill);
      currentBill = [];
      renderBillTable();
      $('customerName').value = '';
    } else {
      showStatus('ບໍ່ສຳເລັດ', data.message || 'ເກີດຂໍ້ຜິດພາດ', 'error');
    }
  } catch(e) {
    hideLoading();
    showStatus('ຂໍ້ຜິດພາດ', 'ເຊື່ອມຕໍ່ບໍ່ໄດ້', 'error');
  }
}

/* ── Thai 2-digit modal ──────────────────────────────────────── */
function openThai2Modal(num, amt) {
  _t2pos   = 'TOP';
  _t2focus = 'top';
  $('thai2Num').textContent   = num;
  $('thai2Amt').value         = amt > 0 ? amt : '';
  $('thai2AmtTop').value      = '';
  $('thai2AmtBot').value      = '';
  $('thai2ChipHint').textContent = '';
  setThai2Pos('TOP');
  $('thai2Modal').classList.remove('hidden');
  setTimeout(() => $('thai2Amt').focus(), 100);
}

function closeThai2Modal() {
  $('thai2Modal').classList.add('hidden');
}

function setThai2Pos(pos) {
  _t2pos = pos;
  ['TOP','BOT','BOTH'].forEach(p => {
    $(`thai2${p.charAt(0) + p.slice(1).toLowerCase()}`).classList.toggle('active', pos === p);
  });
  const isBoth = pos === 'BOTH';
  $('thai2Single').classList.toggle('hidden', isBoth);
  $('thai2Double').classList.toggle('hidden', !isBoth);
  $('thai2SingleLabel').textContent = pos === 'TOP' ? 'ຈຳນວນເງິນ (ເທິງ)' : pos === 'BOT' ? 'ຈຳນວນເງິນ (ລຸ່ມ)' : 'ຈຳນວນເງິນ';
  if (isBoth) {
    _t2focus = 'top';
    setTimeout(() => {
      $('thai2AmtTop').style.borderColor = 'rgba(61,220,132,0.6)';
      $('thai2AmtBot').style.borderColor = '';
      $('thai2AmtTop').focus();
    }, 50);
  } else {
    setTimeout(() => $('thai2Amt').focus(), 50);
  }
}

function addThai2Amt(n) {
  const isBoth = _t2pos === 'BOTH';
  if (isBoth) {
    const targetId = _t2focus === 'bot' ? 'thai2AmtBot' : 'thai2AmtTop';
    const el = $(targetId);
    el.value = (parseFloat(el.value) || 0) + n;
    $('thai2ChipHint').textContent = `+${(n/1000).toFixed(0)}K → ${_t2focus === 'bot' ? 'ລຸ່ມ' : 'ເທິງ'}`;
    setTimeout(() => { $('thai2ChipHint').textContent = ''; }, 1500);
  } else {
    $('thai2Amt').value = (parseFloat($('thai2Amt').value) || 0) + n;
  }
}

function confirmThai2() {
  const num = $('thai2Num').textContent;
  const isBoth = _t2pos === 'BOTH';

  if (isBoth) {
    const top = parseFloat($('thai2AmtTop').value) || 0;
    const bot = parseFloat($('thai2AmtBot').value) || 0;
    if (top <= 0 && bot <= 0) {
      showStatus('ຂໍ້ຜິດພາດ', 'ໃສ່ຈຳນວນເງິນຢ່າງໜ້ອຍ 1 ຝ່າຍ', 'error'); return;
    }
    if (top > 0) currentBill.unshift({ num, type: 'THAI', pos: 'TOP', price: top });
    if (bot > 0) currentBill.unshift({ num, type: 'THAI', pos: 'BOT', price: bot });
  } else {
    const amt = parseFloat($('thai2Amt').value) || 0;
    if (amt <= 0) {
      showStatus('ຂໍ້ຜິດພາດ', 'ໃສ່ຈຳນວນເງິນ', 'error'); return;
    }
    currentBill.unshift({ num, type: 'THAI', pos: _t2pos, price: amt });
  }

  closeThai2Modal();
  renderBillTable();
  $('huayNum').value = '';
  $('huayAmt').value = '';
  $('huayNum').focus();
}

/* ── Bill slip modal ─────────────────────────────────────────── */
function openSlipModal(bill) {
  $('slipContent').innerHTML = buildSlipHTML(bill);
  $('slipModal').classList.remove('hidden');
}
function closeSlipModal(e) {
  if (!e || e.target === $('slipModal')) {
    $('slipModal').classList.add('hidden');
  }
}

function buildSlipHTML(bill) {
  const posLabel = { ALL: '—', TOP: 'ເທິງ', BOT: 'ລຸ່ມ' };
  const rows = (bill.items || []).map(it => `
    <div class="slip-row ${bill.canceled ? 'canceled' : ''}">
      <span>${it.num} (${it.type}${it.pos !== 'ALL' ? '/'+posLabel[it.pos] : ''})</span>
      <span>${Number(it.price).toLocaleString()}</span>
    </div>
  `).join('');

  const now = getServerNow();
  return `
    <div class="slip-paper">
      <div class="slip-header">
        <div class="slip-title">HUAYPLUS</div>
        <div class="slip-sub">${bill.billId || ''}</div>
      </div>
      <hr class="slip-divider">
      <div class="slip-row"><span>ຜູ້ຂາຍ</span><span>${bill.staffName || currentUser.name}</span></div>
      ${bill.customer ? `<div class="slip-row"><span>ລູກຄ້າ</span><span>${bill.customer}</span></div>` : ''}
      <div class="slip-row"><span>ວັນທີ</span><span>${fmtDate(now)}</span></div>
      <hr class="slip-divider">
      ${rows}
      <hr class="slip-divider">
      <div class="slip-total"><span>ລວມ</span><span>${fmtMoney(bill.total)}</span></div>
      ${bill.canceled ? `<div style="text-align:center; color:#dc2626; font-size:12px; margin-top:8px;">ຍົກເລີກໂດຍ: ${bill.canceledBy} (${bill.canceledAt})</div>` : ''}
      <div class="slip-footer">ຂໍຂອບໃຈທີ່ໃຊ້ HUAYPLUS</div>
    </div>
  `;
}

async function shareSlip() {
  const el = $('slipContent');
  if (!el) return;
  try {
    // Use html2canvas if available, else copy text
    if (window.html2canvas) {
      const canvas = await html2canvas(el, { backgroundColor: '#f8f9f7', scale: 2 });
      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = 'bill.png'; a.click();
      });
    } else {
      await navigator.clipboard.writeText(el.innerText);
      showStatus('ສຳເລັດ', 'ຄັດລອກຂໍ້ຄວາມໃສ່ clipboard ແລ້ວ', 'success');
    }
  } catch(e) {
    showStatus('ຂໍ້ຜິດພາດ', 'ບໍ່ສາມາດແຊຣ໌ໄດ້', 'error');
  }
}

/* ── Cancel bill ─────────────────────────────────────────────── */
function askCancelBill(billId) {
  _cancelBillId = billId;
  $('cancelBillId').textContent = `ບິນ: ${billId}`;
  $('cancelModal').classList.remove('hidden');
}
function closeCancelModal() {
  _cancelBillId = null;
  $('cancelModal').classList.add('hidden');
}

async function confirmCancel() {
  if (!_cancelBillId) return;
  closeCancelModal();
  showLoading('ກຳລັງຍົກເລີກ...');
  try {
    const data = await api({
      action:    'cancelBill',
      billId:    _cancelBillId,
      canceledBy: currentUser.username,
      canceledName: currentUser.name,
      role:      currentUser.role,
    });
    hideLoading();
    if (data.success) {
      showStatus('ສຳເລັດ', 'ຍົກເລີກບິນແລ້ວ', 'success');
      loadBillHistory();
    } else {
      showStatus('ບໍ່ສຳເລັດ', data.message || '', 'error');
    }
  } catch(e) {
    hideLoading();
    showStatus('ຂໍ້ຜິດພາດ', 'ເຊື່ອມຕໍ່ບໍ່ໄດ້', 'error');
  }
}

/* ════════════════════════════════════════════════════════════ */
/*  STAFF: DASHBOARD                                            */
/* ════════════════════════════════════════════════════════════ */

async function loadMyStats() {
  try {
    const data = await api({ action: 'myStats', username: currentUser.username });
    if (data.success) {
      $('myTodaySales').textContent = fmtMoney(data.today);
      $('myMonthSales').textContent = fmtMoney(data.month);
    }
  } catch(e) { /* silent */ }
}

async function loadDashboard() {
  showLoading();
  try {
    const data = await api({ action: 'myStats', username: currentUser.username });
    hideLoading();
    if (data.success) {
      $('dash_today').textContent     = fmtMoney(data.today);
      $('dash_yesterday').textContent = fmtMoney(data.yesterday);
      $('dash_week').textContent      = fmtMoney(data.week);
      $('dash_month').textContent     = fmtMoney(data.month);
      drawChart('salesChart', data.chart7 || [], data.chart7Labels || []);
    }
  } catch(e) { hideLoading(); }
}

/* ── Mini bar chart ──────────────────────────────────────────── */
function drawChart(canvasId, values, labels) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 300;
  const H = 140;
  canvas.width  = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.clearRect(0, 0, W, H);
  const n    = values.length;
  if (!n) return;
  const max  = Math.max(...values, 1);
  const padL = 8, padR = 8, padT = 20, padB = 22;
  const cW   = W - padL - padR;
  const cH   = H - padT - padB;
  const gap  = cW / n;
  const barW = gap * 0.55;

  values.forEach((v, i) => {
    const x   = padL + i * gap + (gap - barW) / 2;
    const bH  = max > 0 ? (v / max) * cH : 0;
    const y   = padT + cH - bH;
    const isCur = i === n - 1;

    ctx.fillStyle = isCur ? 'rgba(61,220,132,0.9)' : 'rgba(61,220,132,0.3)';
    const r = Math.min(4, barW / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, y + bH);
    ctx.lineTo(x, y + bH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isCur ? 'rgba(61,220,132,0.9)' : 'rgba(61,220,132,0.45)';
    ctx.font = `${isCur ? 600 : 400} 10px IBM Plex Sans, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(labels[i] || '', x + barW / 2, H - 6);

    if (v > 0) {
      const kval = v >= 1000 ? Math.round(v / 1000) + 'K' : v;
      ctx.fillStyle = isCur ? 'rgba(61,220,132,0.9)' : 'rgba(61,220,132,0.6)';
      ctx.font = '9px IBM Plex Sans, sans-serif';
      ctx.fillText(kval, x + barW / 2, y - 4);
    }
  });
}
/* ════════════════════════════════════════════════════════════ */
/*  STAFF: CHECK WIN                                            */
/* ════════════════════════════════════════════════════════════ */

async function runCheckWin() {
  const date = $('checkDate').value;
  const num  = $('checkNum').value.trim();
  const pos  = $('checkPos').value;

  if (!date || !num) {
    showStatus('ຂໍ້ຜິດພາດ', 'ກະລຸນາໃສ່ວັນທີ ແລະ ເລກ', 'error'); return;
  }

  showLoading('ກຳລັງກວດ...');
  try {
    const data = await api({
      action:    'checkWinners',
      username:  currentUser.username,
      role:      currentUser.role,
      date:      date,
      winNum:    num,
      position:  pos,
      huayType:  checkType,
    });
    hideLoading();
    renderCheckResults('checkResults', data.winners || [], num, data.totalPayout);
  } catch(e) {
    hideLoading();
    showStatus('ຂໍ້ຜິດພາດ', 'ເຊື່ອມຕໍ່ບໍ່ໄດ້', 'error');
  }
}

async function runAdminCheckWin() {
  const date = $('adminCheckDate').value;
  const num  = $('adminCheckNum').value.trim();
  const pos  = $('adminCheckPos').value;

  if (!date || !num) {
    showStatus('ຂໍ້ຜິດພາດ', 'ກະລຸນາໃສ່ວັນທີ ແລະ ເລກ', 'error'); return;
  }

  showLoading('ກຳລັງກວດທັງລະບົບ...');
  try {
    const data = await api({
      action:   'checkWinners',
      username: currentUser.username,
      role:     currentUser.role,
      date:     date,
      winNum:   num,
      position: pos,
      huayType: adminCheckType,
    });
    hideLoading();
    renderCheckResults('adminCheckResults', data.winners || [], num, data.totalPayout);
  } catch(e) {
    hideLoading();
    showStatus('ຂໍ້ຜິດພາດ', 'ເຊື່ອມຕໍ່ບໍ່ໄດ້', 'error');
  }
}

function renderCheckResults(containerId, winners, winNum, totalPayout) {
  const el = $(containerId);
  if (!el) return;

  if (winners.length === 0) {
    el.innerHTML = `
      <div class="card" style="text-align:center; padding:28px 16px;">
        <div style="font-size:32px; margin-bottom:8px; opacity:0.3;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <div style="font-size:14px; color:var(--text-2);">ບໍ່ພົບຜູ້ຖືກລາງວັນ</div>
      </div>`;
    return;
  }

  const total = totalPayout || winners.reduce((a, w) => a + (w.payout || 0), 0);
  const posLabel = { ALL: '—', TOP: 'ເທິງ', BOT: 'ລຸ່ມ' };

  el.innerHTML = `
    <div class="card" style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span style="font-size:13px; font-weight:600; color:var(--text-2);">ຜູ້ຖືກລາງວັນ</span>
        <span class="badge badge-green">${winners.length} ໃບ</span>
      </div>
      <div style="font-size:22px; font-weight:700; color:var(--accent);">${fmtMoney(total)}</div>
      <div style="font-size:11px; color:var(--text-3); margin-top:2px;">ຍອດລາງວັນລວມ</div>
    </div>
    ${winners.map(w => `
      <div class="card" style="margin-bottom:8px; cursor:pointer;" onclick="openSlipModal(${JSON.stringify(w).replace(/"/g,'&quot;')})">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:12px; color:var(--text-2);">${w.billId || ''}</span>
          <span style="font-size:13px; font-weight:700; color:var(--accent);">${fmtMoney(w.payout)}</span>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <span style="font-size:22px; font-weight:800; letter-spacing:4px; color:var(--accent);">${winNum}</span>
          <span class="badge badge-green">${w.huayType || ''}</span>
          <span style="font-size:12px; color:var(--text-2);">${posLabel[w.position] || w.position || ''}</span>
          ${w.staffName ? `<span style="font-size:11px; color:var(--text-3);">by ${w.staffName}</span>` : ''}
          ${w.customer  ? `<span style="font-size:11px; color:var(--text-3);">— ${w.customer}</span>` : ''}
        </div>
      </div>
    `).join('')}
  `;
}

/* ════════════════════════════════════════════════════════════ */
/*  STAFF: BILL HISTORY                                         */
/* ════════════════════════════════════════════════════════════ */

let _allBills = [];

async function loadBillHistory() {
  showLoading();
  try {
    const data = await api({ action: 'getBills', username: currentUser.username, role: currentUser.role });
    hideLoading();
    _allBills = data.bills || [];
    renderBillHistory(_allBills);
  } catch(e) {
    hideLoading();
    showStatus('ຂໍ້ຜິດພາດ', 'ໂຫລດບໍ່ໄດ້', 'error');
  }
}

function filterBillHistory(q) {
  const filtered = q
    ? _allBills.filter(b => (b.billId || '').toLowerCase().includes(q.toLowerCase()) || (b.customer || '').toLowerCase().includes(q.toLowerCase()))
    : _allBills;
  renderBillHistory(filtered);
}

function renderBillHistory(bills) {
  const el = $('billHistoryList');
  if (!bills.length) {
    el.innerHTML = `<div style="text-align:center; padding:40px 0; color:var(--text-3); font-size:14px;">ຍັງບໍ່ມີປະຫວັດ</div>`;
    return;
  }

  el.innerHTML = bills.map(b => {
    const canceled = b.canceled || b.status === 'CANCELED';
    const cancelInfo = canceled && b.canceledBy
      ? `<div style="font-size:11px; color:var(--danger); margin-top:4px;">ຍົກເລີກໂດຍ: ${b.canceledBy} — ${b.canceledAt || ''}</div>`
      : '';
    const adminCanceled = canceled && b.canceledByRole === 'superadmin' && currentUser.role === 'staff'
      ? `<div style="font-size:11px; color:var(--danger); background:rgba(248,113,113,0.08); border:1px solid rgba(248,113,113,0.2); border-radius:8px; padding:6px 10px; margin-top:6px;">Admin ຍົກເລີກ — ${b.canceledAt || ''}</div>`
      : '';

    return `
      <div class="card" style="margin-bottom:10px; ${canceled ? 'opacity:0.6;' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div>
            <div style="font-size:13px; font-weight:700; color:var(--text-1);">${b.billId || '—'}</div>
            <div style="font-size:11px; color:var(--text-2); margin-top:2px;">${b.createdAt || ''} ${b.customer ? '• ' + b.customer : ''}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:15px; font-weight:700; color:${canceled ? 'var(--danger)' : 'var(--accent)'};">${fmtMoney(b.total)}</div>
            <span class="badge ${canceled ? 'badge-red' : 'badge-green'}">${canceled ? 'ຍົກເລີກ' : 'ປົກກະຕິ'}</span>
          </div>
        </div>
        ${cancelInfo}${adminCanceled}
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="openBillDetail('${b.billId}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="13" y2="12"/></svg>
            ເບິ່ງໃບບິນ
          </button>
          ${!canceled ? `<button class="btn btn-danger btn-sm" style="flex:1;" onclick="askCancelBill('${b.billId}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            ຍົກເລີກ
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function openBillDetail(billId) {
  const bill = _allBills.find(b => b.billId === billId);
  if (bill) { openSlipModal(bill); return; }
  showLoading();
  try {
    const data = await api({ action: 'getBillDetail', billId });
    hideLoading();
    if (data.success) openSlipModal(data.bill);
  } catch(e) { hideLoading(); }
}

/* ════════════════════════════════════════════════════════════ */
/*  ADMIN: STAFF MANAGEMENT                                     */
/* ════════════════════════════════════════════════════════════ */

async function loadStaffList() {
  showLoading();
  try {
    const data = await api({ action: 'getStaff' });
    hideLoading();
    renderStaffList(data.staff || []);
  } catch(e) { hideLoading(); }
}

function renderStaffList(staff) {
  const el = $('staffList');
  if (!staff.length) {
    el.innerHTML = `<div style="text-align:center; padding:40px 0; color:var(--text-3); font-size:14px;">ຍັງບໍ່ມີພະນັກງານ</div>`;
    return;
  }
  el.innerHTML = staff.map(s => `
    <div class="list-item" style="margin-bottom:8px;">
      <div class="list-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      </div>
      <div class="list-body">
        <div class="list-title">${s.name || s.username}</div>
        <div class="list-sub">@${s.username} ${s.active === false ? '• ປິດໃຊ້' : ''}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-secondary btn-sm" style="padding:6px 10px;" onclick="showEditStaff('${s.username}','${s.name || ''}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-danger btn-sm" style="padding:6px 10px;" onclick="deleteStaff('${s.username}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function showAddStaffModal() {
  _editStaffId = null;
  $('addStaffTitle').textContent = 'ເພີ່ມພະນັກງານ';
  $('newStaffUser').value = '';
  $('newStaffName').value = '';
  $('newStaffPin').value  = '';
  $('newStaffUser').disabled = false;
  $('addStaffModal').classList.remove('hidden');
  setTimeout(() => $('newStaffUser').focus(), 100);
}

function showEditStaff(username, name) {
  _editStaffId = username;
  $('addStaffTitle').textContent = 'ແກ້ໄຂພະນັກງານ';
  $('newStaffUser').value    = username;
  $('newStaffName').value    = name;
  $('newStaffPin').value     = '';
  $('newStaffUser').disabled = true;
  $('addStaffModal').classList.remove('hidden');
}

function closeAddStaffModal() {
  $('addStaffModal').classList.add('hidden');
}

async function saveStaff() {
  const username = $('newStaffUser').value.trim();
  const name     = $('newStaffName').value.trim();
  const pin      = $('newStaffPin').value.trim();

  if (!username || !name) { showStatus('ຂໍ້ຜິດພາດ', 'ຊື່ຜູ້ໃຊ້ ແລະ ຊື່ສະແດງຕ້ອງໃສ່', 'error'); return; }
  if (!_editStaffId && (!pin || pin.length !== 4)) { showStatus('ຂໍ້ຜິດພາດ', 'PIN ຕ້ອງ 4 ຕົວ', 'error'); return; }

  closeAddStaffModal();
  showLoading(_editStaffId ? 'ກຳລັງແກ້ໄຂ...' : 'ກຳລັງເພີ່ມ...');
  try {
    const data = await api({
      action:   _editStaffId ? 'editStaff' : 'addStaff',
      username, name,
      pin:      pin || undefined,
    });
    hideLoading();
    if (data.success) {
      showStatus('ສຳເລັດ', _editStaffId ? 'ແກ້ໄຂແລ້ວ' : 'ເພີ່ມພະນັກງານແລ້ວ', 'success');
      loadStaffList();
    } else {
      showStatus('ບໍ່ສຳເລັດ', data.message || '', 'error');
    }
  } catch(e) { hideLoading(); showStatus('ຂໍ້ຜິດພາດ', 'ເຊື່ອມຕໍ່ບໍ່ໄດ້', 'error'); }
}

async function deleteStaff(username) {
  if (!confirm(`ລົບ @${username} ອອກ?`)) return;
  showLoading();
  try {
    const data = await api({ action: 'deleteStaff', username });
    hideLoading();
    if (data.success) { showStatus('ສຳເລັດ', 'ລົບແລ້ວ', 'success'); loadStaffList(); }
    else showStatus('ບໍ່ສຳເລັດ', data.message || '', 'error');
  } catch(e) { hideLoading(); }
}

/* ════════════════════════════════════════════════════════════ */
/*  ADMIN: SALES                                                */
/* ════════════════════════════════════════════════════════════ */

async function loadAdminSales() {
  showLoading();
  try {
    const data = await api({ action: 'adminSales', date: $('adminBillDate').value });
    hideLoading();
    if (!data.success) return;

    $('adm_today').textContent = fmtMoney(data.today);
    $('adm_week').textContent  = fmtMoney(data.week);

    // Staff rank
    const rankEl = $('staffRankList');
    const rank   = data.rank || [];
    if (rank.length) {
      rankEl.innerHTML = rank.map((s, i) => `
        <div class="list-item" style="margin-bottom:8px;">
          <div style="width:28px; height:28px; border-radius:50%; background:${i===0?'rgba(251,191,36,0.2)':i===1?'rgba(61,220,132,0.1)':'rgba(255,255,255,0.05)'}; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:${i===0?'var(--warning)':'var(--text-2)'}; flex-shrink:0;">${i+1}</div>
          <div class="list-body"><div class="list-title">${s.name}</div><div class="list-sub">@${s.username}</div></div>
          <div style="font-size:15px; font-weight:700; color:var(--accent);">${fmtMoney(s.total)}</div>
        </div>
      `).join('');
    } else {
      rankEl.innerHTML = `<div style="text-align:center; padding:20px 0; color:var(--text-3); font-size:13px;">ຍັງບໍ່ມີຂໍ້ມູນ</div>`;
    }

    drawChart('adminChart', data.chart7 || [], data.chart7Labels || []);

    // All bills for date
    const billEl  = $('adminBillList');
    const bills   = data.bills || [];
    if (bills.length) {
      billEl.innerHTML = bills.map(b => {
        const canceled = b.canceled || b.status === 'CANCELED';
        return `
          <div class="card" style="margin-bottom:8px; ${canceled ? 'opacity:0.55;' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-size:13px; font-weight:600;">${b.billId}</div>
                <div style="font-size:11px; color:var(--text-2);">${b.staffName} ${b.customer ? '• '+b.customer : ''}</div>
                ${b.canceledBy ? `<div style="font-size:10px; color:var(--danger);">ຍົກເລີກ: ${b.canceledBy}</div>` : ''}
              </div>
              <div style="text-align:right;">
                <div style="font-size:14px; font-weight:700; color:${canceled?'var(--danger)':'var(--accent)'};">${fmtMoney(b.total)}</div>
                ${!canceled ? `<button class="btn btn-danger btn-sm" style="margin-top:4px; padding:4px 8px; font-size:11px;" onclick="askCancelBill('${b.billId}')">ຍົກເລີກ</button>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      billEl.innerHTML = `<div style="text-align:center; padding:20px 0; color:var(--text-3); font-size:13px;">ບໍ່ມີບິນ</div>`;
    }
  } catch(e) { hideLoading(); }
}

/* ════════════════════════════════════════════════════════════ */
/*  SETTINGS: PAYOUT / TIME / PASSWORD / EXPORT                */
/* ════════════════════════════════════════════════════════════ */

async function loadTimeLimitSub() {
  try {
    const data = await api({ action: 'getTimeLimits' });
    if (data.success) {
      timeLimits = data.timeLimits;
      $('timeLimitSub').textContent = `ລາວ ${timeLimits.lao} / ໄທ ${timeLimits.thai}`;
    }
  } catch(e) { /* silent */ }
}

async function saveTimeLimits() {
  const lao  = $('laoCloseTime').value;
  const thai = $('thaiCloseTime').value;
  if (!lao || !thai) { showStatus('ຂໍ້ຜິດພາດ', 'ໃສ່ເວລາໃຫ້ຄົບ', 'error'); return; }
  showLoading();
  try {
    const data = await api({ action: 'saveTimeLimits', lao, thai });
    hideLoading();
    if (data.success) {
      timeLimits = { lao, thai };
      showStatus('ສຳເລັດ', 'ບັນທຶກເວລາແລ້ວ', 'success');
    } else showStatus('ຜິດພາດ', data.message || '', 'error');
  } catch(e) { hideLoading(); }
}

async function savePayoutRates() {
  const rates = {
    lao2: $('lao2Rate').value, lao3: $('lao3Rate').value,
    thai2top: $('thai2TopRate').value, thai2bot: $('thai2BotRate').value, thai3: $('thai3Rate').value,
  };
  showLoading();
  try {
    const data = await api({ action: 'savePayoutRates', rates });
    hideLoading();
    if (data.success) showStatus('ສຳເລັດ', 'ບັນທຶກອັດຕາແລ້ວ', 'success');
    else showStatus('ຜິດພາດ', data.message || '', 'error');
  } catch(e) { hideLoading(); }
}

async function changePassword() {
  const oldPass     = $('oldPass').value;
  const newPass     = $('newPass').value;
  const confirmPass = $('confirmPass').value;
  if (!oldPass || !newPass) { showStatus('ຂໍ້ຜິດພາດ', 'ໃສ່ລະຫັດໃຫ້ຄົບ', 'error'); return; }
  if (newPass !== confirmPass) { showStatus('ຂໍ້ຜິດພາດ', 'ລະຫັດໃໝ່ບໍ່ຕົງກັນ', 'error'); return; }
  showLoading();
  try {
    const data = await api({ action: 'changePassword', oldPass, newPass });
    hideLoading();
    if (data.success) {
      showStatus('ສຳເລັດ', 'ປ່ຽນລະຫັດແລ້ວ', 'success');
      $('oldPass').value = ''; $('newPass').value = ''; $('confirmPass').value = '';
    } else showStatus('ຜິດພາດ', data.message || 'ລະຫັດເກົ່າບໍ່ຖືກ', 'error');
  } catch(e) { hideLoading(); }
}

async function doExport(format) {
  const from = $('exportFrom').value;
  const to   = $('exportTo').value;
  if (!from || !to) { showStatus('ຂໍ້ຜິດພາດ', 'ເລືອກຊ່ວງວັນທີ', 'error'); return; }
  showLoading('ກຳລັງ Export...');
  try {
    const data = await api({ action: 'export', format, from, to, username: currentUser.username, role: currentUser.role });
    hideLoading();
    if (data.success && data.url) {
      window.open(data.url, '_blank');
    } else showStatus('ຜິດພາດ', data.message || '', 'error');
  } catch(e) { hideLoading(); showStatus('ຜິດພາດ', 'ເຊື່ອມຕໍ່ບໍ່ໄດ້', 'error'); }
}

/* ════════════════════════════════════════════════════════════ */
/*  ENTER KEY + INPUT HELPERS                                   */
/* ════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // Restore color mode
  const saved = localStorage.getItem('colorMode') || 'dark';
  colorMode   = saved;
  applyColorMode(saved);

  // Enter key on recorder
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const active = document.activeElement;
      if (active && (active.id === 'huayNum' || active.id === 'huayAmt')) {
        addItemToBill();
      }
    }
  });

  // Auto-advance: huayNum (3 chars) → focus huayAmt
  const numInput = $('huayNum');
  if (numInput) {
    numInput.addEventListener('input', () => {
      if (numInput.value.length === 3) {
        setTimeout(() => $('huayAmt').focus(), 50);
      }
    });
  }

  // Login: focus username on load
  setTimeout(() => {
    const u = $('loginUser');
    if (u) u.focus();
  }, 300);

  // Admin bill date change
  const adminBillDate = $('adminBillDate');
  if (adminBillDate) {
    adminBillDate.addEventListener('change', () => loadAdminSales());
  }
});