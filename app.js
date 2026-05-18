const BACKEND_API_URL = "https://script.google.com/macros/s/AKfycbxdJZA_-N-U-9jXPxA0lycEnNkJglioE8eP85WHmOglSKYhX_RKIwY_87IuMb-w2van/exec";

let currentUser = {};
let _sessionToken = null; // token สำหรับ single-session lock
let currentBillItems = [];
let currentHuayType = 'ลาว';
let popupSelectedPosition = 'บน'; 
let serverTimeLimits = { lao: "20:15", thai: "15:15" };
let isAdminLoginMode = false;

// ตัวแปรส่วนกลางสำหรับล็อกเป้าหมายไฮไลต์สีเขียวในบิลตรวจเช็คหวย
let highlightWinningNum = "";
let highlightPositionFilter = "ทั้งหมด";

// ตัวแปรสำหรับจำพิกัดช่องที่นิ้วพนักงานจิ้มล่าสุดใน Pop-up
let popupLastFocusedInput = null; 

document.addEventListener("DOMContentLoaded", function() {
    // ไม่ต้องโหลด dropdown แล้ว พนักงานพิมพ์ชื่อเองได้เลย
    const loginUser = document.getElementById('loginUser');
    if(loginUser) loginUser.focus();
});

// ✨ ฟังก์ชันโหลดรายชื่อพนักงานเข้า Dropdown (เพิ่มเข้าระบบให้สมบูรณ์แล้ว)
function loadUsernames() {
    const select = document.getElementById('loginUser');
    if (!select) return;

    fetch(BACKEND_API_URL, { 
        method: "POST",
        mode: "cors",
        headers: {
            "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({ action: "getUsernames" }) 
    })
    .then(res => {
        if (!res.ok) throw new Error("Network response was not ok");
        return res.json();
    })
    .then(data => {
        select.innerHTML = `<option value="" disabled selected>👇 กรุณาเลือกชื่อบัญชีผู้ใช้งาน...</option>`;
        if (data && data.users && data.users.length > 0) {
            data.users.forEach(u => { 
                select.innerHTML += `<option value="${u}">${u}</option>`; 
            });
        } else {
            select.innerHTML = `<option value="" disabled>❌ ไม่พบรายชื่อพนักงานในระบบ</option>`;
        }
    })
    .catch(err => {
        console.error("Fetch Error:", err);
        select.innerHTML = `<option value="" disabled>💥 เชื่อมต่อไม่สำเร็จ (ลองรีเฟรชหน้าเว็บ)</option>`;
    });
}

let _loginAttempts = 0;
let _loginLocked = false;
let _loginLockTimer = null;

// ✨ ฟังก์ชันจัดการล็อกอินรวมศูนย์
function handleLogin() {
    // ตรวจสอบว่าถูก lock อยู่หรือไม่
    if(_loginLocked) {
        showStatusModal("🔒 ระบบล็อกชั่วคราว", "กรอกรหัสผิดเกิน 5 ครั้ง\nกรุณารอ 5 นาที", false);
        return;
    }
    const userSelect = document.getElementById('loginUser'); // ตอนนี้เป็นช่องพิมพ์แล้ว
    const pinInput = document.getElementById('loginPin');
    const adminPassInput = document.getElementById('adminPassword');
    const adminUserInput = document.getElementById('adminUsername');

    let payload = { action: "login" };

    if (isAdminLoginMode) {
        const username = adminUserInput ? adminUserInput.value.trim() : "";
        const password = adminPassInput ? adminPassInput.value.trim() : "";
        if(!username) { showStatusModal("⚠️ แจ้งเตือน", "กรุณากรอก Username Super Admin", false); return; }
        if(!password) { showStatusModal("⚠️ แจ้งเตือน", "กรุณากรอกรหัสผ่าน Super Admin", false); return; }
        payload.role     = "superadmin";
        payload.username = username;
        payload.password = password;
    } else {
        // 👤 โหมดพนักงานทั่วไป
        const username = userSelect ? userSelect.value.trim() : "";
        const pin = pinInput ? pinInput.value.trim() : "";
        
        if(!username) { 
            alert("⚠️ กรุณาพิมพ์ชื่อบัญชีผู้ใช้งานพนักงานของคุณ"); 
            return; 
        }
        if(!pin) { 
            alert("⚠️ กรุณากรอกรหัส PIN"); 
            return; 
        }
        
        payload.role = "staff";
        payload.username = username;
        payload.pin = pin;
    }
    
    // ยิงข้อมูลตรงไปหลังบ้าน Google Sheets
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: {
            "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error("Network error");
        return res.json();
    })
    .then(data => {
        if(data.success) {
            currentUser = { role: data.role, username: data.username, name: data.name || data.username };
            _sessionToken = data.sessionToken || null; // เก็บ token
            if(pinInput) pinInput.value = ""; 
            if(adminPassInput) adminPassInput.value = "";
            
            const loginBox = document.getElementById('loginContainer');
            if(loginBox) loginBox.classList.add('hidden');
            
            startServerClock();
            loadTimeLimitsFromServer();
            startSessionTimeout();
            startSessionHeartbeat(); // ✅ เริ่ม heartbeat
            showMenu();
        } else {
            clearPinBoxes();

            // ตรวจว่าเป็น session lock หรือ PIN ผิด
            const isSessionLocked = data.message && data.message.includes('กำลังใช้งานอยู่');

            if(isSessionLocked) {
                // แสดง popup พิเศษ — ไม่นับ login attempt
                showSessionLockedModal(data.message);
            } else {
                _loginAttempts++;
                if(_loginAttempts >= 5) {
                    _loginLocked = true;
                    showStatusModal("🔒 ระบบล็อก", `กรอกรหัสผิด 5 ครั้ง\nกรุณารอ 5 นาที`, false);
                    if(_loginLockTimer) clearTimeout(_loginLockTimer);
                    _loginLockTimer = setTimeout(() => {
                        _loginLocked = false;
                        _loginAttempts = 0;
                        showStatusModal("🔓 ปลดล็อกแล้ว", "สามารถเข้าสู่ระบบได้อีกครั้ง", true);
                    }, 5 * 60 * 1000);
                } else {
                    const remain = 5 - _loginAttempts;
                    showStatusModal("❌ เข้าสู่ระบบไม่สำเร็จ", `ชื่อหรือรหัส PIN ไม่ถูกต้อง\nเหลืออีก ${remain} ครั้ง`, false);
                }
            }
        }
    })
    .catch(err => {
        alert("💥 ไม่สามารถเชื่อมต่อกับหลังบ้านได้ กรุณาตรวจสอบการตั้งค่า URL");
        console.error("Login Error:", err);
    });
}

// PIN Box functions
function focusPinBox(index) {
    const el = document.getElementById('pin' + index);
    if(el) el.focus();
}

function onPinInput(el, index) {
    // รับเฉพาะตัวเลข
    el.value = el.value.replace(/[^0-9]/g, '');
    if(el.value.length === 1 && index < 3) {
        focusPinBox(index + 1);
    }
    // sync loginPin hidden input
    syncPinValue();
    // highlight border
    el.style.borderColor = el.value ? 'var(--ios-blue)' : 'var(--border-color)';
}

function onPinKey(event, index) {
    if(event.key === 'Backspace') {
        const el = document.getElementById('pin' + index);
        if(!el.value && index > 0) {
            focusPinBox(index - 1);
            document.getElementById('pin' + (index-1)).value = '';
            syncPinValue();
        }
    }
}

let _pinLoginPending = false;

function syncPinValue() {
    let pin = '';
    for(let i = 0; i < 4; i++) {
        const el = document.getElementById('pin' + i);
        pin += el ? (el.value || '') : '';
    }
    const hidden = document.getElementById('loginPin');
    if(hidden) hidden.value = pin;
    // auto login เมื่อครบ 4 หลัก — ป้องกันเรียกซ้ำ
    if(pin.length === 4 && !_pinLoginPending) {
        _pinLoginPending = true;
        setTimeout(() => { _pinLoginPending = false; handleLogin(); }, 150);
    }
}

function clearPinBoxes() {
    _pinLoginPending = false;
    for(let i = 0; i < 4; i++) {
        const el = document.getElementById('pin' + i);
        if(el) { el.value = ''; el.style.borderColor = 'var(--border-color)'; }
    }
    const hidden = document.getElementById('loginPin');
    if(hidden) hidden.value = '';
}

function toggleAdminPasswordVisibility() {
    const input = document.getElementById('adminPassword');
    const btn   = document.getElementById('adminPassToggleBtn');
    if(!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? '🙈' : '👁️';
    btn.style.opacity = isHidden ? '1' : '0.5';
}

function showSessionLockedModal(message) {
    // ลบ modal เก่าถ้ามี
    const old = document.getElementById('sessionLockedModal');
    if(old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'sessionLockedModal';
    modal.className = 'modal-backdrop';
    modal.style.zIndex = '2000';
    modal.innerHTML = `
        <div style="background:var(--bg-card); border:2px solid var(--ios-pink); border-radius:20px; padding:28px 24px; width:100%; max-width:320px; text-align:center;">
            <div style="font-size:52px; margin-bottom:12px;">🔒</div>
            <div style="font-size:17px; font-weight:900; color:var(--ios-pink); margin-bottom:10px;">กำลังใช้งานอยู่</div>
            <div style="font-size:13px; color:var(--text-muted); line-height:1.7; margin-bottom:20px; white-space:pre-line;">${message.replace(/⚠️/g,'').trim()}</div>
            <button onclick="document.getElementById('sessionLockedModal').remove()"
                style="width:100%; background:var(--ios-pink); color:#fff; border:none; border-radius:12px; padding:14px; font-size:15px; font-weight:700; cursor:pointer;">
                ตกลง
            </button>
        </div>`;
    document.body.appendChild(modal);
}

function toggleLoginMode() {
    isAdminLoginMode = !isAdminLoginMode;
    const staffSection = document.getElementById('staffLoginSection');
    const adminSection = document.getElementById('adminLoginSection');
    const subtitle     = document.getElementById('loginSubtitle');
    const thumb        = document.getElementById('modeSwitchThumb');
    const track        = document.getElementById('modeSwitchTrack');
    const labelLeft    = document.getElementById('modeSwitchLabel');
    const labelRight   = document.getElementById('modeSwitchLabelRight');
    const avatar       = document.getElementById('loginAvatar');

    if (isAdminLoginMode) {
        staffSection.classList.add('hidden');
        adminSection.classList.remove('hidden');
        if(subtitle)    subtitle.innerText = "โหมด Super Admin";
        if(thumb)       thumb.style.transform = 'translateX(16px)';
        if(track)       track.style.background = 'var(--ios-pink)';
        if(labelLeft)   labelLeft.style.color = 'var(--text-muted)';
        if(labelRight)  { labelRight.innerText = 'Admin'; labelRight.style.color = 'var(--ios-pink)'; }
        if(avatar)      avatar.style.borderColor = 'var(--ios-pink)';
        setTimeout(() => { const ap = document.getElementById('adminUsername'); if(ap) ap.focus(); }, 100);
    } else {
        staffSection.classList.remove('hidden');
        adminSection.classList.add('hidden');
        if(subtitle)    subtitle.innerText = "เข้าสู่ระบบพนักงาน";
        if(thumb)       thumb.style.transform = 'translateX(0)';
        if(track)       track.style.background = 'var(--ios-blue)';
        if(labelLeft)   labelLeft.style.color = 'var(--text-muted)';
        if(labelRight)  { labelRight.innerText = 'Admin'; labelRight.style.color = 'var(--ios-blue)'; }
        if(avatar)      avatar.style.borderColor = 'var(--ios-blue)';
        clearPinBoxes();
        setTimeout(() => { const lu = document.getElementById('loginUser'); if(lu) lu.focus(); }, 100);
    }
}

function showLoading(status) {
    let loading = document.getElementById('loadingOverlay');
    if(!loading) {
        // สร้าง overlay อัตโนมัติถ้าไม่มีใน HTML
        loading = document.createElement('div');
        loading.id = 'loadingOverlay';
        loading.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;z-index:9999;';
        loading.innerHTML = '<div style="color:#fff;font-size:18px;font-weight:bold;text-align:center;"><div style="font-size:40px;margin-bottom:10px;">⏳</div>กำลังประมวลผล...</div>';
        document.body.appendChild(loading);
    }
    loading.style.display = status ? 'flex' : 'none';
}

function initRecorderPage() {
    hideAllPages();
    showPage('recorderWrapper');
    document.getElementById('recorderTitle') && (document.getElementById('recorderTitle').innerText = `📝 ลงบิลแทงหวย`);
    currentBillItems = [];
    renderBillTable();
    generateBillId();
}

// 🗑️ ล้างรายการทั้งหมดในบิล
function clearAllBillItems() {
    if(currentBillItems.length === 0) return;
    if(!confirm(`⚠️ ล้างรายการทั้งหมด ${currentBillItems.length} รายการ?\nไม่สามารถกู้คืนได้`)) return;
    currentBillItems = [];
    renderBillTable();
}

// 🧾 ประวัติบิลพนักงาน
let _allBillHistory = [];

function loadBillHistory() {
    const list = document.getElementById('billHistoryList');
    list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">⏳ กำลังโหลด...</div>`;
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"loadDashboard", username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        if(!data.success) { list.innerHTML = `<p style="color:red;text-align:center;">โหลดไม่สำเร็จ</p>`; return; }
        const billMap = {};
        (data.rawData || []).forEach(row => {
            if(!billMap[row.billId]) billMap[row.billId] = { billId: row.billId, date: row.date, status: row.status, items: [], total: 0 };
            billMap[row.billId].items.push(row);
            if(row.status !== 'ยกเลิก') billMap[row.billId].total += row.price;
            if(row.status === 'ยกเลิก') billMap[row.billId].status = 'ยกเลิก';
        });
        _allBillHistory = Object.values(billMap);
        renderBillHistory(_allBillHistory);
    }).catch(err => { list.innerHTML = `<p style="color:red;text-align:center;">${err}</p>`; });
}

function renderBillHistory(bills) {
    const list = document.getElementById('billHistoryList');
    if(!bills.length) { list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">📭 ไม่มีประวัติบิล</div>`; return; }
    list.innerHTML = bills.map(b => {
        const isCanceled = b.status === 'ยกเลิก';
        const color = isCanceled ? 'var(--ios-pink)' : 'var(--ios-green)';
        return `
        <div style="padding:10px; border-bottom:1px solid var(--border-color); cursor:pointer;" 
             onclick="viewSpecificBill('${b.billId}'); goToDashboard();">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:11px; font-weight:800; color:var(--ios-blue);">${b.billId}</div>
                    <div style="font-size:11px; color:var(--text-muted);">📅 ${b.date} | ${b.items.length} รายการ</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:13px; font-weight:800; color:${color};">${b.total.toLocaleString()} ₭</div>
                    <div style="font-size:10px; color:${color};">${isCanceled ? '❌ ยกเลิก' : '✅ ปกติ'}</div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function filterBillHistory() {
    const q = document.getElementById('historySearchInput').value.trim().toLowerCase();
    if(!q) { renderBillHistory(_allBillHistory); return; }
    renderBillHistory(_allBillHistory.filter(b => b.billId.toLowerCase().includes(q) || b.date.includes(q)));
}

// ปุ่ม "บันทึกยอดและออกบิล" — HTML เรียกตัวนี้
function processSubmitFinalSale() {
    // เช็คเวลาอีกครั้งก่อนบันทึก
    if(isTimeLimitExceeded(currentHuayType)) {
        showTimeLimitPopup(currentHuayType);
        return;
    }
    submitBillToServer();
}

// สลับประเภทหวย ลาว/ไทย
function setHuayType(type) {
    currentHuayType = type;
    document.getElementById('typeLao').classList.toggle('active', type === 'ลาว');
    document.getElementById('typeThai').classList.toggle('active', type === 'ไทย');
}

// เมื่อพิมพ์เลข — ล้างช่องเงินให้พิมพ์ใหม่
function handleNumChange() {
    const num = document.getElementById('huayNum').value;
    // ถ้าเลข 3 ตัว แสดงป้ายบอก
}

// กดชิป 1K 5K 10K 20K 50K — บวกเพิ่มในช่องเงิน
function addMainQuickAmt(amt) {
    const input = document.getElementById('huayAmt');
    const cur = parseFloat(input.value) || 0;
    input.value = cur + amt;
}

// ปุ่ม "เพิ่มรายการลงบิล"
function addItemsToCurrentBillDirect() {
    const num = document.getElementById('huayNum').value.trim();
    const amt = parseFloat(document.getElementById('huayAmt').value) || 0;

    if(!num) { alert("⚠️ กรุณากรอกตัวเลขหวย"); return; }
    if(num.length < 2 || num.length > 3) { alert("⚠️ กรอกเลข 2 หรือ 3 ตัวเท่านั้น"); return; }

    // ✅ เช็คเวลาจาก server ก่อนขาย
    if(isTimeLimitExceeded(currentHuayType)) {
        showTimeLimitPopup(currentHuayType);
        return;
    }

    const isThaiTwoDigit = (currentHuayType === 'ไทย' && num.length === 2);

    if(isThaiTwoDigit) {
        // เปิด popup ถามบน/ล่าง/บน+ล่าง
        openThaiTwoDigitPopup(num);
        return;
    }

    // ลาว 2ตัว, ลาว 3ตัว, ไทย 3ตัว → ไม่มีบน/ล่าง เพิ่มตรงได้เลย
    if(amt <= 0) { alert("⚠️ กรุณากรอกจำนวนเงิน"); return; }

    const typeLabel = currentHuayType + '-' + num.length + 'ตัว';
    currentBillItems.unshift({ num, position: 'รวม', price: amt, type: typeLabel });

    renderBillTable();
    document.getElementById('huayNum').value = '';
    document.getElementById('huayAmt').value = '';
    document.getElementById('huayNum').focus();
}

// 🎯 Popup สำหรับหวยไทย 2 ตัว
function openThaiTwoDigitPopup(num) {
    // ลบ popup เก่าถ้ามี
    const old = document.getElementById('thai2PopupModal');
    if(old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'thai2PopupModal';
    modal.className = 'modal-backdrop';
    modal.style.zIndex = '1001';
    modal.innerHTML = `
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:20px; padding:20px; width:100%; max-width:340px;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
                <span style="font-size:16px; font-weight:700; color:#fff;">🎯 หวยไทย 2 ตัว: <strong style="color:var(--ios-blue); font-size:20px;">${num}</strong></span>
                <button onclick="closeThaiTwoPopup()" style="background:rgba(255,69,58,0.2); color:var(--ios-pink); border:none; border-radius:8px; padding:4px 10px; font-size:13px; cursor:pointer;">✕</button>
            </div>

            <!-- เลือกตำแหน่ง -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:16px;">
                <button id="thai2BtnTop" onclick="setThai2Pos('บน')" 
                    style="background:var(--ios-blue); color:#fff; border:none; border-radius:10px; padding:10px; font-size:14px; font-weight:700; cursor:pointer;">บน</button>
                <button id="thai2BtnBot" onclick="setThai2Pos('ล่าง')"
                    style="background:#1c2333; color:var(--text-muted); border:1px solid var(--border-color); border-radius:10px; padding:10px; font-size:14px; font-weight:700; cursor:pointer;">ล่าง</button>
                <button id="thai2BtnBoth" onclick="setThai2Pos('บน+ล่าง')"
                    style="background:#1c2333; color:var(--text-muted); border:1px solid var(--border-color); border-radius:10px; padding:10px; font-size:14px; font-weight:700; cursor:pointer;">บน+ล่าง</button>
            </div>

            <!-- ช่องเงิน บน -->
            <div id="thai2TopSection" style="margin-bottom:12px;">
                <label style="font-size:12px; font-weight:600; color:var(--ios-blue); display:block; margin-bottom:6px;">💰 จำนวนเงิน [บน] (₭)</label>
                <input type="number" id="thai2AmtTop" placeholder="ระบุยอดเงิน" inputmode="numeric"
                    style="width:100%; background:#1c2333; border:2px solid var(--ios-blue); border-radius:10px; padding:12px; color:#fff; font-size:18px; font-weight:700; text-align:center;">
                <div style="display:flex; gap:6px; margin-top:6px;">
                    <button onclick="addThai2Amt('top',1000)" class="btn-amt-chip">1K</button>
                    <button onclick="addThai2Amt('top',5000)" class="btn-amt-chip">5K</button>
                    <button onclick="addThai2Amt('top',10000)" class="btn-amt-chip">10K</button>
                    <button onclick="addThai2Amt('top',20000)" class="btn-amt-chip">20K</button>
                    <button onclick="addThai2Amt('top',50000)" class="btn-amt-chip">50K</button>
                </div>
            </div>

            <!-- ช่องเงิน ล่าง -->
            <div id="thai2BotSection" style="margin-bottom:16px; display:none;">
                <label style="font-size:12px; font-weight:600; color:var(--ios-pink); display:block; margin-bottom:6px;">💰 จำนวนเงิน [ล่าง] (₭)</label>
                <input type="number" id="thai2AmtBot" placeholder="ระบุยอดเงิน" inputmode="numeric"
                    style="width:100%; background:#1c2333; border:2px solid var(--ios-pink); border-radius:10px; padding:12px; color:#fff; font-size:18px; font-weight:700; text-align:center;">
                <div style="display:flex; gap:6px; margin-top:6px;">
                    <button onclick="addThai2Amt('bot',1000)" class="btn-amt-chip">1K</button>
                    <button onclick="addThai2Amt('bot',5000)" class="btn-amt-chip">5K</button>
                    <button onclick="addThai2Amt('bot',10000)" class="btn-amt-chip">10K</button>
                    <button onclick="addThai2Amt('bot',20000)" class="btn-amt-chip">20K</button>
                    <button onclick="addThai2Amt('bot',50000)" class="btn-amt-chip">50K</button>
                </div>
            </div>

            <button onclick="confirmThai2Add('${num}')" 
                style="width:100%; background:var(--ios-green); color:#fff; border:none; border-radius:12px; padding:14px; font-size:16px; font-weight:700; cursor:pointer;">
                ➕ เพิ่มรายการลงบิล
            </button>
        </div>`;
    document.body.appendChild(modal);
    window._thai2Pos = 'บน'; // default
}

function closeThaiTwoPopup() {
    const m = document.getElementById('thai2PopupModal');
    if(m) m.remove();
}

function setThai2Pos(pos) {
    window._thai2Pos = pos;
    const btnTop  = document.getElementById('thai2BtnTop');
    const btnBot  = document.getElementById('thai2BtnBot');
    const btnBoth = document.getElementById('thai2BtnBoth');
    const topSec  = document.getElementById('thai2TopSection');
    const botSec  = document.getElementById('thai2BotSection');

    // reset buttons
    [btnTop, btnBot, btnBoth].forEach(b => {
        b.style.background = '#1c2333';
        b.style.color = 'var(--text-muted)';
        b.style.border = '1px solid var(--border-color)';
    });

    if(pos === 'บน') {
        btnTop.style.background = 'var(--ios-blue)';
        btnTop.style.color = '#fff';
        btnTop.style.border = 'none';
        topSec.style.display = 'block';
        botSec.style.display = 'none';
        document.querySelector('#thai2TopSection label').style.color = 'var(--ios-blue)';
        document.querySelector('#thai2TopSection input').style.borderColor = 'var(--ios-blue)';
    } else if(pos === 'ล่าง') {
        btnBot.style.background = 'var(--ios-pink)';
        btnBot.style.color = '#fff';
        btnBot.style.border = 'none';
        topSec.style.display = 'none';
        botSec.style.display = 'block';
    } else { // บน+ล่าง
        btnBoth.style.background = 'var(--ios-green)';
        btnBoth.style.color = '#fff';
        btnBoth.style.border = 'none';
        topSec.style.display = 'block';
        botSec.style.display = 'block';
    }
}

function addThai2Amt(side, amt) {
    const id = side === 'top' ? 'thai2AmtTop' : 'thai2AmtBot';
    const el = document.getElementById(id);
    el.value = (parseFloat(el.value) || 0) + amt;
}

function confirmThai2Add(num) {
    const pos     = window._thai2Pos || 'บน';
    const amtTop  = parseFloat(document.getElementById('thai2AmtTop').value) || 0;
    const amtBot  = parseFloat(document.getElementById('thai2AmtBot') ? document.getElementById('thai2AmtBot').value : 0) || 0;

    if(pos === 'บน' && amtTop <= 0)       { alert("⚠️ กรุณากรอกจำนวนเงิน [บน]"); return; }
    if(pos === 'ล่าง' && amtBot <= 0)     { alert("⚠️ กรุณากรอกจำนวนเงิน [ล่าง]"); return; }
    if(pos === 'บน+ล่าง' && amtTop <= 0 && amtBot <= 0) { alert("⚠️ กรุณากรอกจำนวนเงินอย่างน้อย 1 ช่อง"); return; }

    if(pos === 'บน' || pos === 'บน+ล่าง') {
        if(amtTop > 0) currentBillItems.unshift({ num, position: 'บน',  price: amtTop, type: 'ไทย-2ตัว' });
    }
    if(pos === 'ล่าง' || pos === 'บน+ล่าง') {
        if(amtBot > 0) currentBillItems.unshift({ num, position: 'ล่าง', price: amtBot, type: 'ไทย-2ตัว' });
    }

    closeThaiTwoPopup();
    renderBillTable();
    document.getElementById('huayNum').value = '';
    document.getElementById('huayAmt').value = '';
    document.getElementById('huayNum').focus();
}

function generateBillId() {
    const now = new Date();
    const timestamp = now.getFullYear().toString().substring(2) +
                      (now.getMonth()+1).toString().padStart(2,'0') +
                      now.getDate().toString().padStart(2,'0') + "-" +
                      now.getHours().toString().padStart(2,'0') +
                      now.getMinutes().toString().padStart(2,'0') +
                      now.getSeconds().toString().padStart(2,'0');

    const billIdEl = document.getElementById('billIdDisplay');
    if(billIdEl) billIdEl.innerText = `INV-${timestamp}`;

    // วันที่อัตโนมัติ = วันนี้
    const y = now.getFullYear();
    const m = (now.getMonth()+1).toString().padStart(2,'0');
    const d = now.getDate().toString().padStart(2,'0');
    const dateVal = `${y}-${m}-${d}`;
    const dateDisplay = `${d}/${m}/${y}`;

    const dateInput = document.getElementById('billTargetDate');
    if(dateInput) dateInput.value = dateVal;

    const dateDisp = document.getElementById('billDateDisplay');
    if(dateDisp) dateDisp.innerText = dateDisplay;
}

function selectHuay(type) {
    currentHuayType = type;
    initRecorderPage();
}

function addNumRow(num, b, l, t) {
    if(!num) return;
    let entries = [];
    if(b > 0) entries.push({ num: num, position: 'บน', price: b, rate: (num.length===3?850:92), type: num.length+'ตัว' });
    if(l > 0) entries.push({ num: num, position: 'ล่าง', price: l, rate: (num.length===3?0:92), type: num.length+'ตัว' });
    if(t > 0 && num.length === 3) entries.push({ num: num, position: 'โต๊ด', price: t, rate: 140, type: '3ตัว' });
    
    if(entries.length === 0) return;
    
    // หาเป้าหมายวันที่ส่งเลข
    const targetDateStr = document.getElementById('billTargetDate').value;
    if(!targetDateStr) { alert("กรุณาเลือกวันที่ก่อนเพิ่มรายการ"); return; }
    
    const parts = targetDateStr.split("-");
    const formattedDate = `${parseInt(parts[2])}/${parseInt(parts[1])}/${parseInt(parts[0])}`;
    
    entries.forEach(e => {
        e.date = formattedDate;
        currentBillItems.unshift(e);
    });
    renderBillTable();
}

function renderBillTable() {
    // HTML ใช้ id="billTableItems" และ id="currentBillTotalLabel"
    const table = document.getElementById('billTableItems');
    const tbody = table ? table.querySelector('tbody') : null;
    if(!tbody) return;
    tbody.innerHTML = "";
    let total = 0;
    currentBillItems.forEach((item, index) => {
        total += item.price;
        tbody.innerHTML += `
            <tr>
                <td style="font-weight:700;">${item.num}</td>
                <td style="font-size:12px;">${item.type||''} ${item.position}</td>
                <td style="text-align:right;">${item.price.toLocaleString()}</td>
                <td style="text-align:center;"><button class="btn btn-danger" style="padding:2px 8px; font-size:11px; width:auto;" onclick="removeBillItem(${index})">❌</button></td>
            </tr>
        `;
    });
    const totalEl = document.getElementById('currentBillTotalLabel');
    if(totalEl) totalEl.innerText = total.toLocaleString() + " ₭";
}

function removeBillItem(index) {
    currentBillItems.splice(index, 1);
    renderBillTable();
}

function quickAmt(amt) {
    if (!popupLastFocusedInput) return;
    let currentVal = parseFloat(popupLastFocusedInput.value) || 0;
    popupLastFocusedInput.value = currentVal + amt;
}

function clearPopupInputs() {
    document.getElementById('popNum').value = "";
    document.getElementById('popB').value = "";
    document.getElementById('popL').value = "";
    document.getElementById('popT').value = "";
    popupLastFocusedInput = null;
}

function openKeyboardPopup(pos) {
    popupSelectedPosition = pos;
    clearPopupInputs();
    document.getElementById('popupPositionTitle').innerText = `ป้อนรายการตำแหน่ง: [${pos}]`;
    document.getElementById('keyboardPopupModal').style.display = 'flex';
    document.getElementById('popNum').focus();
}

function closeKeyboardPopup() {
    document.getElementById('keyboardPopupModal').style.display = 'none';
}

function rememberFocus(inputElement) {
    popupLastFocusedInput = inputElement;
}

function pressKey(key) {
    if (!popupLastFocusedInput) {
        popupLastFocusedInput = document.getElementById('popNum');
    }
    
    if (key === 'CLEAR') {
        popupLastFocusedInput.value = "";
        return;
    }
    
    if (popupLastFocusedInput.id === 'popNum') {
        if (popupLastFocusedInput.value.length >= 3) return;
        popupLastFocusedInput.value += key;
    } else {
        popupLastFocusedInput.value += key;
    }
}

function submitPopupRow() {
    const num = document.getElementById('popNum').value.trim();
    const b = parseFloat(document.getElementById('popB').value) || 0;
    const l = parseFloat(document.getElementById('popL').value) || 0;
    const t = parseFloat(document.getElementById('popT').value) || 0;
    
    if(!num) { alert("กรุณาป้อนตัวเลขหวย"); return; }
    if(num.length !== 2 && num.length !== 3) { alert("ป้อนได้เฉพาะเลข 2 ตัว หรือ 3 ตัว เท่านั้น"); return; }
    if(b===0 && l===0 && t===0) { alert("กรุณาใส่จำนวนเงินอย่างน้อย 1 ช่อง"); return; }
    
    addNumRow(num, b, l, t);
    clearPopupInputs();
    document.getElementById('popNum').focus();
}

function submitBillToServer() {
    if(currentBillItems.length === 0) { showStatusModal("แจ้งเตือน", "ไม่มีรายการในบิล ไม่สามารถบันทึกได้", false); return; }

    // สร้าง billId ใหม่ตอน submit ทันที ไม่อ่านจาก element
    const now = new Date();
    const ts = (now.getFullYear()+'').substring(2) +
               (now.getMonth()+1).toString().padStart(2,'0') +
               now.getDate().toString().padStart(2,'0') + '-' +
               now.getHours().toString().padStart(2,'0') +
               now.getMinutes().toString().padStart(2,'0') +
               now.getSeconds().toString().padStart(2,'0');
    const billId = `INV-${ts}`;

    // อัปเดต display
    const billIdEl = document.getElementById('billIdDisplay');
    if(billIdEl) billIdEl.innerText = billId;

    // วันที่ = วันนี้เสมอ
    const formattedDate = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
    const items = currentBillItems.map(it => ({ ...it, date: formattedDate }));

    const payload = {
        action: "saveBill",
        username: currentUser.username,
        billId: billId,
        customer: document.getElementById('customerName') ? document.getElementById('customerName').value.trim() : '',
        items: items
    };

    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: "POST", mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        if(data.success) {
            showStatusModal("💎 สำเร็จ", data.message, true, function() {
                showReceiptSlipDirect(billId, currentUser.username, formattedDate, items);
            });
        } else {
            showStatusModal("❌ ล้มเหลว", data.message, false);
        }
    }).catch(err => { showLoading(false); showStatusModal("ระบบขัดข้อง", err.toString(), false); });
}

// แสดงใบบิน fixed — auto scale font ตามจำนวนรายการ ไม่ scroll เลย
function showReceiptSlipDirect(billId, staffName, dateStr, items) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const total = items.reduce((s, it) => s + it.price, 0);

    // ขนาดคงที่ 9:16 (540×960) ไม่ยืดหดตามเนื้อหา
    const W = 540, H = 960;

    // 5 คอลัมน์ คอลัมน์ละ 10 รายการ (max 50 รายการ)
    const cols = [items.slice(0,10), items.slice(10,20), items.slice(20,30), items.slice(30,40), items.slice(40,50)];

    // font size คงที่ ไม่ขึ้นกับจำนวน เพราะ canvas size ล็อคแล้ว
    const numSize=13, typeSize=9, amtSize=11, rowPad=4;

    function renderCol(arr) {
        // แต่ละ col มีพื้นที่ 10 slot คงที่ แม้ข้อมูลน้อยก็ไม่ยุบ
        const rows = [];
        for(let i = 0; i < 10; i++) {
            const it = arr[i];
            if(it) {
                const posLabel = (it.position && it.position !== 'รวม') ? ' '+it.position : '';
                rows.push(`<div style="padding:${rowPad}px 0; border-bottom:1px solid #e2e8f0; flex:1;">
                    <div style="font-size:${numSize}px; font-weight:900; color:#0f172a; line-height:1.2;">${it.num}</div>
                    <div style="font-size:${typeSize}px; color:#94a3b8; line-height:1.1;">${it.type||''}${posLabel}</div>
                    <div style="font-size:${amtSize}px; font-weight:700; color:#1d4ed8; line-height:1.2;">${(it.price/1000).toFixed(0)}K</div>
                </div>`);
            } else {
                // slot ว่าง — ยึดพื้นที่ไว้
                rows.push(`<div style="flex:1; border-bottom:1px solid #f1f5f9; padding:${rowPad}px 0;"></div>`);
            }
        }
        return `<div style="display:flex; flex-direction:column; height:100%;">${rows.join('')}</div>`;
    }

    const slipHtml = `
        <div id="receiptSlipCapture" style="
            background:#fff; color:#000;
            width:${W}px; height:${H}px;
            padding:20px 16px 16px;
            border-radius:16px;
            font-family:'Noto Sans Thai',sans-serif;
            display:flex; flex-direction:column;
            box-sizing:border-box; overflow:hidden;">

            <!-- Header -->
            <div style="text-align:center; padding-bottom:8px; margin-bottom:8px; border-bottom:2px dashed #cbd5e1; flex-shrink:0;">
                <div style="font-size:22px; font-weight:900; color:#000; letter-spacing:2px;">HUAYPLUS</div>
                <div style="font-size:11px; color:#64748b;">ใบบินขายหวยดิจิทัล</div>
            </div>

            <!-- Meta -->
            <div style="display:flex; justify-content:space-between; font-size:11px; color:#475569; margin-bottom:4px; flex-shrink:0;">
                <span>วันที่: <strong>${dateStr}</strong></span>
                <span>เวลา: <strong>${timeStr}</strong></span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11px; color:#475569; padding-bottom:6px; margin-bottom:8px; border-bottom:1px dashed #cbd5e1; flex-shrink:0;">
                <span>พนักงาน: <strong>${staffName}</strong></span>
                <span style="color:#0a84ff; font-weight:700; font-size:10px;">${billId}</span>
            </div>

            <!-- 5 คอลัมน์ เต็มพื้นที่ที่เหลือ -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr; gap:4px; flex:1; overflow:hidden;">
                ${cols.map(c => renderCol(c)).join('')}
            </div>

            <!-- Footer ยอดรวม -->
            <div style="border-top:2px solid #000; border-bottom:2px solid #000; padding:8px 0; text-align:center; margin-top:8px; flex-shrink:0;">
                <span style="font-size:13px; font-weight:700;">ยอดรวมเงินทั้งหมด: </span>
                <strong style="font-size:20px; font-weight:900;">${total.toLocaleString()} ₭</strong>
            </div>
        </div>`;

    let modal = document.getElementById('receiptSlipModal');
    if(!modal) {
        modal = document.createElement('div');
        modal.id = 'receiptSlipModal';
        modal.className = 'modal-backdrop';
        modal.style.cssText = 'display:none;z-index:1001;align-items:center;justify-content:center;flex-direction:column;gap:8px;padding:12px;overflow-y:auto;';
        modal.innerHTML = `
            <div id="receiptSlipContent" style="transform-origin:top center;"></div>
            <div id="receiptSlipImgWrap" style="display:none; flex-direction:column; align-items:center; gap:8px;">
                <p style="color:#fff; font-size:12px; text-align:center; margin:0; opacity:0.8;">👆 กดค้างที่รูปเพื่อบันทึก / Copy</p>
                <img id="receiptSlipImg" style="max-width:300px; width:100%; border-radius:12px; display:block; -webkit-user-select:auto; user-select:auto;" draggable="true">
            </div>
            <button id="receiptRenderBtn" onclick="renderReceiptToImage()" style="background:#0a84ff;color:#fff;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;width:300px;">📸 แปลงเป็นรูปเพื่อบันทึก</button>
            <button onclick="closeReceiptAndReset()" style="background:#ff453a;color:#fff;border:none;border-radius:12px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;width:300px;">❌ ปิดและขายต่อ</button>`;
        document.body.appendChild(modal);
    }
    // ---- off-screen render: วาง HTML นอกจอ render แล้วค่อยเปิด modal ----
    // 1. เตรียม off-screen container
    let offscreen = document.getElementById('_slipOffscreen');
    if(!offscreen) {
        offscreen = document.createElement('div');
        offscreen.id = '_slipOffscreen';
        offscreen.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;z-index:-1;';
        document.body.appendChild(offscreen);
    }
    offscreen.innerHTML = slipHtml;

    // reset modal state — ยังไม่เปิด
    document.getElementById('receiptSlipImgWrap').style.display = 'none';
    document.getElementById('receiptSlipContent').innerHTML = '';
    const rBtn = document.getElementById('receiptRenderBtn');
    if(rBtn) rBtn.style.display = 'none';

    // แสดง loading overlay แทน modal จริง ระหว่างรอ render
    showLoading(true);

    // 2. render จาก off-screen element
    if(typeof html2canvas === 'undefined') {
        showLoading(false);
        // fallback: แสดง HTML ปกติ
        document.getElementById('receiptSlipContent').innerHTML = slipHtml;
        document.getElementById('receiptSlipContent').style.display = 'block';
        modal.style.display = 'flex';
        return;
    }

    const captureEl = offscreen.querySelector('#receiptSlipCapture');
    html2canvas(captureEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(canvas => {
        showLoading(false);
        const dataUrl = canvas.toDataURL('image/png');
        offscreen.innerHTML = ''; // ล้าง off-screen

        // 3. ใส่รูปใน modal แล้วเปิด — user เห็นรูปทันทีเลย
        const img = document.getElementById('receiptSlipImg');
        if(img) {
            img.src = dataUrl;
            img.style.display = 'block';
        }
        document.getElementById('receiptSlipImgWrap').style.display = 'flex';
        document.getElementById('receiptSlipContent').style.display = 'none';
        modal.style.display = 'flex';
    }).catch(() => {
        showLoading(false);
        offscreen.innerHTML = '';
        // fallback: แสดง HTML ปกติ
        document.getElementById('receiptSlipContent').innerHTML = slipHtml;
        document.getElementById('receiptSlipContent').style.display = 'block';
        modal.style.display = 'flex';
    });
}

// แปลง HTML → <img> จริงๆ ให้ iOS long-press native ได้เลย
function renderReceiptToImage() {
    const el = document.getElementById('receiptSlipCapture');
    if(!el) return;
    if(typeof html2canvas === 'undefined') { alert('ไม่พบ html2canvas'); return; }

    // แสดง loading spinner ระหว่างรอ
    const wrap = document.getElementById('receiptSlipImgWrap');
    const img  = document.getElementById('receiptSlipImg');
    if(wrap && img) {
        img.src = '';
        wrap.style.display = 'flex';
        img.style.display = 'none';
        // ใส่ spinner ชั่วคราว
        let spinner = wrap.querySelector('.slip-spinner');
        if(!spinner) {
            spinner = document.createElement('div');
            spinner.className = 'slip-spinner';
            spinner.style.cssText = 'color:#fff;font-size:13px;opacity:0.7;padding:20px 0;';
            spinner.innerText = '⏳ กำลังสร้างรูปใบบิน...';
            wrap.insertBefore(spinner, img);
        }
        spinner.style.display = 'block';
    }

    html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(canvas => {
        const dataUrl = canvas.toDataURL('image/png');
        if(img) {
            img.src = dataUrl;
            img.style.display = 'block';
            // ซ่อน HTML ต้นฉบับ
            const content = document.getElementById('receiptSlipContent');
            if(content) content.style.display = 'none';
            // ซ่อน spinner
            const sp = wrap ? wrap.querySelector('.slip-spinner') : null;
            if(sp) sp.style.display = 'none';
        }
    }).catch(() => {
        const content = document.getElementById('receiptSlipContent');
        if(content) content.style.display = 'block';
        if(wrap) wrap.style.display = 'none';
        alert('แปลงรูปไม่สำเร็จ กรุณาลองใหม่');
    });
}

// compat
function captureReceiptSlip() { renderReceiptToImage(); }

function closeReceiptAndReset() {
    const modal = document.getElementById('receiptSlipModal');
    if(modal) modal.style.display = 'none';
    // ล้างชื่อลูกค้าและทุกช่อง พร้อมขายคนต่อไป
    const customerEl = document.getElementById('customerName');
    if(customerEl) customerEl.value = '';
    initRecorderPage();
}

function openReceiptSlip(billId) {
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "searchBills", billId: billId, username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        if(!data.success) { alert(data.message); return; }
        
        document.getElementById('slipBillId').innerText = data.billId;
        document.getElementById('slipStaffName').innerText = data.username;
        document.getElementById('slipDate').innerText = data.items[0].date;
        
        const c1 = document.getElementById('slipCol1');
        const c2 = document.getElementById('slipCol2');
        const c3 = document.getElementById('slipCol3');
        c1.innerHTML = ""; c2.innerHTML = ""; c3.innerHTML = "";
        
        let total = 0;
        data.items.forEach((item, idx) => {
            total += item.price;
            const text = `${item.num}=${item.price.toLocaleString()}(${item.position.substring(0,1)})<br>`;
            if(idx % 3 === 0) c1.innerHTML += text;
            else if(idx % 3 === 1) c2.innerHTML += text;
            else c3.innerHTML += text;
        });
        
        document.getElementById('slipTotalAmt').innerText = total.toLocaleString() + " ₭";
        document.getElementById('receiptSlipModal').style.display = 'flex';
    }).catch(err => { showLoading(false); alert("ไม่สามารถดึงใบบิลพิมพ์ได้: " + err.toString()); });
}

function closeSlipModal() {
    document.getElementById('receiptSlipModal').style.display = 'none';
    initRecorderPage();
}

function loadDashboardData() {
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "loadDashboard", username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        if(!data.success) return;
        
        // คำนวณยอดวันนี้ / เมื่อวาน / 30 วัน จาก rawData
        const now = new Date();
        const todayStr = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
        const yest = new Date(now); yest.setDate(yest.getDate()-1);
        const yesterdayStr = `${yest.getDate()}/${yest.getMonth()+1}/${yest.getFullYear()}`;
        const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate()-30);
        
        let todaySales = 0, yesterdaySales = 0, monthSales = 0, weekSales = 0;
        (data.rawData || []).forEach(row => {
            if(row.status === 'ยกเลิก') return;
            const parts = row.date.split('/');
            if(parts.length === 3) {
                const rowDate = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
                if(rowDate >= thirtyDaysAgo) monthSales += row.price;
                const diffDays = Math.floor((now - rowDate) / 86400000);
                if(diffDays <= 6) weekSales += row.price;
            }
            if(row.date === todayStr) todaySales += row.price;
            if(row.date === yesterdayStr) yesterdaySales += row.price;
        });
        
        // อัปเดต stat cards ตาม ID ที่มีจริงใน HTML
        const statToday = document.getElementById('statToday');
        const statYesterday = document.getElementById('statYesterday');
        const statMonth = document.getElementById('statMonth');
        const statWeek = document.getElementById('statWeek');
        if(statToday) statToday.innerText = todaySales.toLocaleString() + " ₭";
        if(statYesterday) statYesterday.innerText = yesterdaySales.toLocaleString() + " ₭";
        if(statMonth) statMonth.innerText = monthSales.toLocaleString() + " ₭";
        if(statWeek) statWeek.innerText = weekSales.toLocaleString() + " ₭";

        // วาดกราฟ 7 วันย้อนหลัง
        renderSalesChart(data.rawData || []);

        // Super admin: แสดงยอดแยกพนักงาน + หน้าตั้งค่าอัตราจ่าย
        if(currentUser.role === 'superadmin') {
            const sec = document.getElementById('superAdminStaffSection');
            const container = document.getElementById('staffTotalListContainer');
            const rateCard = document.getElementById('payoutSettingsCard');
            if(sec) sec.classList.remove('hidden');
            if(rateCard) rateCard.classList.remove('hidden');
            if(container) {
                container.innerHTML = `<div style="font-size:15px; font-weight:bold; color:var(--ios-green);">💰 ยอดขายรวม: ${data.totalSales.toLocaleString()} ₭ | บิลปกติ: ${data.activeBills} | ยกเลิก: ${data.canceledBills}</div>`;
            }
        }
    }).catch(err => { console.error(err); });
}

function viewSpecificBill(billId) {
    document.getElementById('searchBillInput').value = billId;
    triggerBillSearch();
}

function triggerBillSearch() {
    const billId = document.getElementById('searchBillInput').value.trim();
    if(!billId) { alert("กรุณาใส่เลขบิลที่ต้องค้นหา"); return; }
    
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "searchBills", billId: billId, username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        const resultDiv = document.getElementById('searchBillResultBlock');
        resultDiv.innerHTML = "";
        
        if(!data.success) {
            resultDiv.innerHTML = `<div class="card" style="text-align:center; color:var(--ios-pink); padding:20px;">${data.message}</div>`;
            return;
        }
        
        let itemsHtml = "";
        let total = 0;
        data.items.forEach(it => {
            total += it.price;
            itemsHtml += `
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #1e293b; padding:8px 0; font-size:14px;">
                    <span>🔢 ตัวเลข: <strong>${it.num}</strong> <mark style="background:none; color:var(--ios-blue);">[${it.position}]</mark></span>
                    <span>💵 ยอดแทง: <strong>${it.price.toLocaleString()} ₭</strong></span>
                </div>
            `;
        });
        
        const isCanceled = data.status === "ยกเลิก";
        const actionBtnHtml = isCanceled ? 
            `<button class="btn btn-secondary" style="width:100%; margin-top:15px;" disabled>❌ บิลนี้ถูกยกเลิกแล้ว</button>` :
            `<button class="btn btn-danger" style="width:100%; margin-top:15px; font-weight:bold;" onclick="executeCancelBill('${data.billId}')">🔥 สั่งยกเลิกบิลใบนี้ (คืนเงิน)</button>`;
            
        resultDiv.innerHTML = `
            <div class="card" style="border:2px solid var(--border-color); padding:16px;">
                <h3 style="font-size:16px; border-bottom:2px solid var(--ios-blue); padding-bottom:6px; margin-bottom:10px;">🧾 ข้อมูลรหัสบิล: ${data.billId}</h3>
                <p style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">👤 พนักงานผู้ขาย: ${data.username} | 📅 วันที่หวยออก: ${data.items[0].date}</p>
                ${itemsHtml}
                <div style="text-align:right; margin-top:12px; font-size:15px; font-weight:bold; color:var(--ios-green);">ยอดสุทธิในบิล: ${total.toLocaleString()} ₭</div>
                ${actionBtnHtml}
            </div>
        `;
    }).catch(err => { showLoading(false); alert("ค้นหาล้มเหลว: " + err.toString()); });
}

function executeCancelBill(billId) {
    if(!confirm(`⚠️ คุณแน่ใจชัวร์ไหมที่จะทำการ 'ยกเลิกบิล' รหัส: ${billId}?\nเมื่อยกเลิกแล้ว ยอดขายจะถูกตัดออกทันที!`)) return;
    
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "cancelBill", billId: billId, username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        if(data.success) {
            showStatusModal("💎 สำเร็จ", data.message, true, function() {
                triggerBillSearch();
                loadDashboardData();
            });
        } else {
            showStatusModal("❌ ล้มเหลว", data.message, false);
        }
    }).catch(err => { showLoading(false); alert(err.toString()); });
}

function runWinnerCheck() {
    const winNum = document.getElementById('searchWinNum').value.trim();       // ✅ ID จริงใน HTML
    const posFilter = document.getElementById('searchPosition').value;          // ✅ ID จริงใน HTML
    const targetDateStr = document.getElementById('searchDate').value;          // ✅ ID จริงใน HTML
    
    if(!winNum || !targetDateStr) { alert("กรุณาใส่เลขรางวัลและเลือกวันที่ต้องการตรวจบิลผู้โชคดี"); return; }
    
    const parts = targetDateStr.split("-");
    const formattedDate = `${parseInt(parts[2])}/${parseInt(parts[1])}/${parseInt(parts[0])}`;
    
    highlightWinningNum = winNum;
    highlightPositionFilter = posFilter;
    
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            action: "checkWinners",
            winningNum: winNum,
            positionFilter: posFilter,
            targetDate: formattedDate,
            username: currentUser.username,
            role: currentUser.role
        })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        const div = document.getElementById('winnersResultList');
        div.innerHTML = "";
        
        if(!data.success || data.data.length === 0) {
            div.innerHTML = `<div class="card" style="text-align:center; padding:20px; color:var(--text-muted);">📭 ไม่พบรายการถูกรางวัลตามเงื่อนไขที่ระบุ</div>`;
            return;
        }

        // จัดกลุ่มผลลัพธ์ตาม billId
        const billMap = {};
        let grandTotal = 0;
        data.data.forEach(w => {
            grandTotal += w.winAmount;
            if(!billMap[w.billId]) billMap[w.billId] = { billId: w.billId, username: w.username, date: w.date, items: [], totalWin: 0 };
            billMap[w.billId].items.push(w);
            billMap[w.billId].totalWin += w.winAmount;
        });

        // เก็บ winnerData ไว้ใน global หลีกเลี่ยงปัญหา JSON ใน onclick
        window._winnerBillMap = billMap;

        let html = '';
        Object.values(billMap).forEach((bill, idx) => {
            let itemsHtml = '';
            bill.items.forEach(w => {
                itemsHtml += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; margin-bottom:6px; border-radius:10px; background:rgba(48,209,88,0.15); border:1px solid rgba(48,209,88,0.3);">
                        <div>
                            <span style="font-size:20px; font-weight:900; color:#fff; background:var(--ios-green); padding:2px 10px; border-radius:8px; margin-right:6px;">🎯 ${w.num}</span>
                            <span style="font-size:13px; color:var(--text-muted);">[${w.position}]</span>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:12px; color:var(--text-muted);">ซื้อ: ${w.price.toLocaleString()} ₭</div>
                            <div style="font-size:15px; font-weight:800; color:var(--ios-green);">💸 ${w.winAmount.toLocaleString()} ₭</div>
                        </div>
                    </div>`;
            });
            html += `
                <div class="card" style="border:2px solid rgba(48,209,88,0.4); margin-bottom:12px; padding:14px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div>
                            <div style="font-size:11px; color:var(--ios-blue); font-weight:700;">
                                <span style="background:var(--ios-blue); color:#fff; border-radius:50%; width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; margin-right:4px;">${idx+1}</span>
                                ${bill.billId}
                            </div>
                            <div style="font-size:12px; color:var(--text-muted);">👤 ${bill.username} | 📅 ${bill.date}</div>
                        </div>
                        <button onclick="openWinnerSlip('${bill.billId}')"
                            style="background:var(--ios-blue); color:#fff; border:none; border-radius:10px; padding:8px 14px; font-size:13px; font-weight:700; cursor:pointer;">
                            🧾 ดูใบบิน
                        </button>
                    </div>
                    ${itemsHtml}
                    <div style="text-align:right; padding-top:8px; border-top:1px dashed var(--border-color); margin-top:4px; font-size:14px; font-weight:800; color:var(--ios-green);">
                        รวมรางวัลบิลนี้: ${bill.totalWin.toLocaleString()} ₭
                    </div>
                </div>`;
        });

        html += `
            <div style="padding:12px 16px; background:rgba(48,209,88,0.2); border-radius:12px; text-align:center; font-weight:900; color:var(--ios-green); font-size:18px; border:2px solid rgba(48,209,88,0.5);">
                💰 รวมยอดรางวัลทั้งหมด: ${grandTotal.toLocaleString()} ₭
            </div>`;

        // ปุ่มบันทึกผลรางวัล (เฉพาะ superadmin)
        if(currentUser.role === 'superadmin') {
            const totalBills = Object.keys(billMap).length;
            html += `
            <button onclick="saveWinResultToHistory('${winNum}','${posFilter}','${formattedDate}',${totalBills},${grandTotal})"
                style="width:100%; background:#15803d; color:#fff; border:none; border-radius:12px; padding:14px; font-size:15px; font-weight:700; cursor:pointer; margin-top:8px;">
                ✅ บันทึกผลรางวัลวันนี้ลงประวัติ
            </button>`; 
        }

        div.innerHTML = html;
        div.style.maxHeight = 'none';
        loadDashboardData();
    }).catch(err => { showLoading(false); alert(err.toString()); });
}

// alias ให้ตรงกับ HTML ที่เรียก executeSearchWinners()
function executeSearchWinners() { runWinnerCheck(); }

// 🎯 เปิดใบบินผู้ถูกรางวัล — ไฮไลต์เลขถูก พร้อมบันทึกรูปส่งลูกค้า
function openWinnerSlip(billId) {
    const billData = window._winnerBillMap && window._winnerBillMap[billId];
    const winItems = billData ? billData.items : [];

    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "searchBills", billId: billId, username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        if(!data.success) { alert(data.message); return; }

        // ชุดเลขที่ถูกรางวัล
        const winSet = new Set();
        winItems.forEach(w => winSet.add(w.num + '_' + w.position));

        const now = new Date();
        const dateStr = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
        const timeStr = now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

        // แบ่ง items เป็น 3 คอลัมน์ คอลัมน์ละ 15 รายการ
        const col1 = data.items.slice(0, 10);
        const col2 = data.items.slice(10, 20);
        const col3 = data.items.slice(20, 30);
        const col4 = data.items.slice(30, 40);
        const col5 = data.items.slice(40, 50);
        let total = 0;
        data.items.forEach(it => total += it.price);

        const W = 540, H = 960;
        const winTotal = winItems.reduce((s,w) => s + w.winAmount, 0); // ✅ declare ที่นี่
        const cols = [col1, col2, col3, col4, col5];
        const numSize=13, typeSize=9, amtSize=11, rowPad=4;

        function renderCol(arr, startIdx) {
            const rows = [];
            for(let i = 0; i < 10; i++) {
                const it = arr[i];
                if(it) {
                    const isWin = winSet.has(it.num + '_' + it.position);
                    const bg       = isWin ? '#bbf7d0' : 'transparent';
                    const numColor = isWin ? '#15803d' : '#0f172a';
                    const amtColor = isWin ? '#15803d' : '#1d4ed8';
                    const winMark  = isWin ? '✅' : '';
                    const posLabel = (it.position && it.position !== 'รวม') ? ' '+it.position : '';
                    rows.push(`<div style="padding:${rowPad}px 0;border-bottom:1px solid #e2e8f0;background:${bg};border-radius:3px;flex:1;">
                        <div style="font-size:${numSize}px;font-weight:900;color:${numColor};line-height:1.2;">${winMark}${it.num}</div>
                        <div style="font-size:${typeSize}px;color:#94a3b8;line-height:1.1;">${it.type||''}${posLabel}</div>
                        <div style="font-size:${amtSize}px;font-weight:700;color:${amtColor};line-height:1.2;">${(it.price/1000).toFixed(0)}K</div>
                    </div>`);
                } else {
                    rows.push(`<div style="flex:1; border-bottom:1px solid #f1f5f9; padding:${rowPad}px 0;"></div>`);
                }
            }
            return `<div style="display:flex; flex-direction:column; height:100%;">${rows.join('')}</div>`;
        }

        const slipHtml = `
            <div id="winnerSlipCapture" style="
                background:#fff; color:#000;
                width:${W}px; height:${H}px;
                padding:20px 16px 16px;
                border-radius:16px;
                font-family:'Noto Sans Thai',sans-serif;
                display:flex; flex-direction:column;
                box-sizing:border-box; overflow:hidden;">

                <!-- Header -->
                <div style="text-align:center; padding-bottom:8px; margin-bottom:8px; border-bottom:2px dashed #cbd5e1; flex-shrink:0;">
                    <div style="font-size:22px; font-weight:900; color:#000; letter-spacing:2px;">HUAYPLUS</div>
                    <div style="font-size:11px; color:#64748b;">ใบบินขายหวยดิจิทัล</div>
                </div>

                <!-- Meta -->
                <div style="display:flex; justify-content:space-between; font-size:11px; color:#475569; margin-bottom:4px; flex-shrink:0;">
                    <span>วันที่: <strong>${dateStr}</strong></span>
                    <span>เวลา: <strong>${timeStr}</strong></span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:11px; color:#475569; padding-bottom:6px; margin-bottom:8px; border-bottom:1px dashed #cbd5e1; flex-shrink:0;">
                    <span>พนักงาน: <strong>${data.username}</strong></span>
                    <span style="color:#0a84ff; font-weight:700; font-size:10px;">${data.billId}</span>
                </div>

                <!-- 5 คอลัมน์ เต็มพื้นที่ที่เหลือ -->
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr; gap:4px; flex:1; overflow:hidden;">
                    ${cols.map((c,i) => renderCol(c, i*10)).join('')}
                </div>

                <!-- Footer -->
                <div style="border-top:2px solid #000; border-bottom:2px solid #000; padding:6px 0; text-align:center; margin-top:8px; flex-shrink:0;">
                    <span style="font-size:13px; font-weight:700;">ยอดรวมเงินทั้งหมด: </span>
                    <strong style="font-size:20px; font-weight:900;">${total.toLocaleString()} ₭</strong>
                </div>
                ${winTotal > 0 ? `
                <div style="background:#dcfce7;border:2px solid #16a34a;border-radius:8px;padding:6px 8px;text-align:center;margin-top:6px;flex-shrink:0;">
                    <div style="font-size:11px;color:#15803d;font-weight:700;">🏆 ยอดรางวัลที่ถูก</div>
                    <div style="font-size:18px;font-weight:900;color:#15803d;">${winTotal.toLocaleString()} ₭</div>
                </div>` : ''}
            </div>`;

        let modal = document.getElementById('winnerSlipModal');
        if(!modal) {
            modal = document.createElement('div');
            modal.id = 'winnerSlipModal';
            modal.className = 'modal-backdrop';
            modal.style.cssText = 'display:none;z-index:1001;align-items:center;justify-content:center;flex-direction:column;gap:8px;padding:12px;overflow-y:auto;';
            modal.innerHTML = `
                <div id="winnerSlipContent" style="transform-origin:top center;"></div>
                <div id="winnerSlipImgWrap" style="display:none; flex-direction:column; align-items:center; gap:8px;">
                    <p style="color:#fff; font-size:12px; text-align:center; margin:0; opacity:0.8;">👆 กดค้างที่รูปเพื่อบันทึก / Copy</p>
                    <img id="winnerSlipImg" style="max-width:300px; width:100%; border-radius:12px; display:block; -webkit-user-select:auto; user-select:auto;" draggable="true">
                </div>
                <button id="winnerRenderBtn" onclick="renderWinnerToImage()" style="background:#0a84ff;color:#fff;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;width:300px;">📸 แปลงเป็นรูปเพื่อบันทึก</button>
                <button onclick="document.getElementById('winnerSlipModal').style.display='none'" style="background:#ff453a;color:#fff;border:none;border-radius:12px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;width:300px;">❌ ปิดหน้าต่าง</button>`;
            document.body.appendChild(modal);
        }
        // ---- off-screen render ----
        let offscreen = document.getElementById('_slipOffscreen');
        if(!offscreen) {
            offscreen = document.createElement('div');
            offscreen.id = '_slipOffscreen';
            offscreen.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;z-index:-1;';
            document.body.appendChild(offscreen);
        }
        offscreen.innerHTML = slipHtml;

        document.getElementById('winnerSlipImgWrap').style.display = 'none';
        document.getElementById('winnerSlipContent').innerHTML = '';
        const wBtn = document.getElementById('winnerRenderBtn');
        if(wBtn) wBtn.style.display = 'none';

        showLoading(true);

        if(typeof html2canvas === 'undefined') {
            showLoading(false);
            document.getElementById('winnerSlipContent').innerHTML = slipHtml;
            document.getElementById('winnerSlipContent').style.display = 'block';
            modal.style.display = 'flex';
            return;
        }

        const captureEl = offscreen.querySelector('#winnerSlipCapture');
        html2canvas(captureEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(canvas => {
            showLoading(false);
            const dataUrl = canvas.toDataURL('image/png');
            offscreen.innerHTML = '';

            const img = document.getElementById('winnerSlipImg');
            if(img) { img.src = dataUrl; img.style.display = 'block'; }
            document.getElementById('winnerSlipImgWrap').style.display = 'flex';
            document.getElementById('winnerSlipContent').style.display = 'none';
            modal.style.display = 'flex';
        }).catch(() => {
            showLoading(false);
            offscreen.innerHTML = '';
            document.getElementById('winnerSlipContent').innerHTML = slipHtml;
            document.getElementById('winnerSlipContent').style.display = 'block';
            modal.style.display = 'flex';
        });

    }).catch(err => { showLoading(false); alert(err.toString()); });
}

function renderWinnerToImage() {
    const el = document.getElementById('winnerSlipCapture');
    if(!el) return;
    if(typeof html2canvas === 'undefined') { alert('ไม่พบ html2canvas'); return; }

    const wrap = document.getElementById('winnerSlipImgWrap');
    const img  = document.getElementById('winnerSlipImg');
    if(wrap && img) {
        img.src = '';
        wrap.style.display = 'flex';
        img.style.display = 'none';
        let spinner = wrap.querySelector('.slip-spinner');
        if(!spinner) {
            spinner = document.createElement('div');
            spinner.className = 'slip-spinner';
            spinner.style.cssText = 'color:#fff;font-size:13px;opacity:0.7;padding:20px 0;';
            spinner.innerText = '⏳ กำลังสร้างรูปใบบิน...';
            wrap.insertBefore(spinner, img);
        }
        spinner.style.display = 'block';
    }

    html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(canvas => {
        const dataUrl = canvas.toDataURL('image/png');
        if(img) {
            img.src = dataUrl;
            img.style.display = 'block';
            const content = document.getElementById('winnerSlipContent');
            if(content) content.style.display = 'none';
            const sp = wrap ? wrap.querySelector('.slip-spinner') : null;
            if(sp) sp.style.display = 'none';
        }
    }).catch(() => {
        const content = document.getElementById('winnerSlipContent');
        if(content) content.style.display = 'block';
        if(wrap) wrap.style.display = 'none';
        alert('แปลงรูปไม่สำเร็จ กรุณาลองใหม่');
    });
}

// compat
function captureWinnerSlip() { renderWinnerToImage(); }

function openTamraBook() {
    document.getElementById('tamraBookModal').style.display = 'flex';
    const listBlock = document.getElementById('tamraListBlock');
    listBlock.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:20px;">⏳ กำลังกางสมุดตำราฝันลาวโบราณ...</p>`;
    
    fetch(BACKEND_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "getTamra" })
    })
    .then(res => res.json()).then(data => {
        listBlock.innerHTML = "";
        if(!data.success || data.data.length === 0) {
            listBlock.innerHTML = `<p style="text-align:center; color:var(--ios-pink);">ไม่พบข้อมูลในตารางตำราฝัน</p>`;
            return;
        }
        
        data.data.forEach(t => {
            listBlock.innerHTML += `
                <div class="tamra-item" onclick="selectTamraNum('${t.num}')">
                    <span class="tamra-num">${t.num}</span>
                    <span class="tamra-name">${t.name}</span>
                </div>
            `;
        });
    }).catch(err => { listBlock.innerHTML = `<p style="text-align:center; color:red;">เชื่อมต่อตำราฝันล้มเหลว</p>`; });
}

function selectTamraNum(num) {
    document.getElementById('popNum').value = num;
    closeTamraBook();
    document.getElementById('popB').focus();
}

function closeTamraBook() {
    document.getElementById('tamraBookModal').style.display = 'none';
}

function filterTamra() {
    const query = document.getElementById('tamraSearchInput').value.trim().toLowerCase();
    const items = document.querySelectorAll('.tamra-item');
    items.forEach(it => {
        const text = it.innerText.toLowerCase();
        if(text.includes(query)) { it.style.display = 'flex'; } else { it.style.display = 'none'; }
    });
}

function logout() {
    // แจ้ง backend ปลด session lock
    if(_sessionToken && currentUser.username) {
        fetch(BACKEND_API_URL, {
            method: "POST", mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "unlockSession", username: currentUser.username, sessionToken: _sessionToken })
        }).catch(() => {});
    }
    _sessionToken = null;
    if(_heartbeatInterval) clearInterval(_heartbeatInterval);
    currentUser = {};
    if(_clockInterval) clearInterval(_clockInterval);
    if(_sessionTimer) clearTimeout(_sessionTimer);
    hideAllPages();
    const mainApp = document.getElementById('mainApp');
    if(mainApp) mainApp.style.display = 'none';
    const loginBox = document.getElementById('loginContainer');
    if(loginBox) { loginBox.style.display = 'flex'; loginBox.classList.remove('hidden'); }
    clearPinBoxes();
    const loginUser = document.getElementById('loginUser');
    if(loginUser) loginUser.value = '';
}

let statusModalTimer = null; let statusModalCallback = null;

function showStatusModal(title, message, isSuccess, callback) {
    if(statusModalTimer) clearTimeout(statusModalTimer);

    // ใช้แค่ title สั้นๆ — ไม่แสดง message ยาว
    const shortTitle = isSuccess ? 'สำเร็จ' :
        (title.includes('⚠️') || title.includes('แจ้งเตือน') || title.includes('หมดเวลา') || title.includes('ใกล้') || title.includes('ล็อก') || title.includes('ปลดล็อก'))
            ? title.replace(/[💎💥⚠️🔒🔓✅❌]/g,'').trim()
            : 'ไม่สำเร็จ';

    document.getElementById('statusTitle').innerText = shortTitle;
    statusModalCallback = callback;

    // เลือก SVG
    const svgSuccess = document.getElementById('statusSvgSuccess');
    const svgFail    = document.getElementById('statusSvgFail');
    const svgWarn    = document.getElementById('statusSvgWarn');
    [svgSuccess, svgFail, svgWarn].forEach(s => s.style.display = 'none');

    function resetAndAnimate(svgEl) {
        svgEl.style.display = 'block';
        const strokes = svgEl.querySelectorAll('[stroke-dashoffset]');
        strokes.forEach(el => {
            const orig = el.getAttribute('stroke-dasharray');
            el.style.transition = 'none';
            el.style.strokeDashoffset = orig;
        });
        const dots = svgEl.querySelectorAll('circle[fill]:not([fill="none"])');
        dots.forEach(el => { el.style.transition = 'none'; el.style.opacity = '0'; });

        requestAnimationFrame(() => requestAnimationFrame(() => {
            strokes.forEach(el => {
                const t = el.getAttribute('style') || '';
                const m = t.match(/transition:([^;]+)/);
                el.style.transition = m ? m[0] : '';
                el.style.strokeDashoffset = '0';
            });
            dots.forEach(el => {
                el.style.transition = 'opacity 0.2s ease 0.6s';
                el.style.opacity = '1';
            });
        }));
    }

    const titleEl = document.getElementById('statusTitle');
    const isWarn = !isSuccess && (title.includes('⚠️') || title.includes('แจ้งเตือน') || title.includes('หมดเวลา') || title.includes('ใกล้') || title.includes('ล็อก') || title.includes('ปลดล็อก'));

    if(isSuccess) {
        resetAndAnimate(svgSuccess);
        titleEl.style.color = '#30d158';
    } else if(isWarn) {
        resetAndAnimate(svgWarn);
        titleEl.style.color = '#ff9f0a';
    } else {
        resetAndAnimate(svgFail);
        titleEl.style.color = '#ff453a';
    }

    document.getElementById('statusModal').style.display = 'flex';
    const delay = isSuccess ? 1400 : 2200;
    statusModalTimer = setTimeout(() => closeStatusModal(), delay);
}

function closeStatusModal() {
    if(statusModalTimer) clearTimeout(statusModalTimer);
    document.getElementById('statusModal').style.display = 'none';
    document.getElementById('statusTitle').style.color = '';
    if(statusModalCallback && typeof statusModalCallback === 'function') {
        statusModalCallback();
        statusModalCallback = null;
    }
}

function hideAllPages() { 
    ['menuPage','recorderWrapper','dashboardPage','adminSettingsPage',
     'superAdminMenuPage','staffPage','timeLimitPage','checkWinPage',
     'billHistoryPage','checkWinStaffPage','payoutPage','settingsPage',
     'payoutSettingPage','changePassPage','colorModePage',
     'staffSalesPage','totalSalesPage','winnerStatPage','staffBreakdownPage'
    ].forEach(id => {
        const el = document.getElementById(id);
        if(el) { el.classList.add('hidden'); el.style.display = 'none'; }
    });
}

function goToSubSales(pageId) {
    hideAllPages();
    showPage(pageId);
    if(pageId === 'totalSalesPage' || pageId === 'winnerStatPage') loadAdminSalesReport();
    if(pageId === 'staffBreakdownPage') {
        // ตั้งวันที่เป็นวันนี้อัตโนมัติ
        const now = new Date();
        const dateEl = document.getElementById('staffBreakdownDate');
        if(dateEl && !dateEl.value) {
            dateEl.value = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
        }
        loadStaffBreakdown();
    }
}

function setStaffBreakdownDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const val = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    document.getElementById('staffBreakdownDate').value = val;
    loadStaffBreakdown();
}

function clearStaffBreakdownDate() {
    document.getElementById('staffBreakdownDate').value = '';
    loadStaffBreakdown();
}

function loadStaffBreakdown() {
    const dateEl = document.getElementById('staffBreakdownDate');
    const selectedDate = dateEl ? dateEl.value : '';
    const container = document.getElementById('staffSalesContainer');
    const label = document.getElementById('staffBreakdownLabel');
    if(container) container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted);">⏳ กำลังโหลด...</div>`;

    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"loadDashboard", username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        if(!data.success) return;

        // กรองตามวันที่ถ้าเลือก
        let filterDate = '';
        if(selectedDate) {
            const parts = selectedDate.split('-');
            filterDate = `${parseInt(parts[2])}/${parseInt(parts[1])}/${parseInt(parts[0])}`;
            if(label) label.innerText = `📋 ยอดขายแยกรายพนักงาน — วันที่ ${filterDate}`;
        } else {
            if(label) label.innerText = '📋 ยอดขายแยกรายพนักงาน (ทั้งหมด)';
        }

        // คำนวณยอดแยกพนักงาน
        const staffMap = {};
        (data.rawData || []).forEach(row => {
            if(row.status === 'ยกเลิก') return;
            if(filterDate && row.date !== filterDate) return;
            const u = row.username || 'ไม่ระบุ';
            if(!staffMap[u]) staffMap[u] = 0;
            staffMap[u] += row.price;
        });

        if(Object.keys(staffMap).length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">📭 ไม่มีข้อมูลยอดขาย</div>`;
            return;
        }

        container.innerHTML = Object.entries(staffMap)
            .sort((a,b) => b[1]-a[1])
            .map(([name, amt]) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid var(--border-color);">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:50%; background:rgba(10,132,255,0.15); display:flex; align-items:center; justify-content:center; font-size:16px;">👤</div>
                        <span style="font-weight:700; font-size:15px;">${name}</span>
                    </div>
                    <span style="color:var(--ios-green); font-weight:800; font-size:15px;">${amt.toLocaleString()} ₭</span>
                </div>`).join('');
    }).catch(err => console.error(err));
}

function goToSubSetting(pageId) {
    hideAllPages();
    showPage(pageId);
    if(pageId === 'payoutSettingPage') loadPayoutSettings();
    if(pageId === 'colorModePage')     initColorModeUI();
    if(pageId === 'timeLimitPage')     loadTimeLimits();
}

// helper แสดง page แบบ flex
function showPage(id) {
    const el = document.getElementById(id);
    if(el) { 
        el.classList.remove('hidden'); 
        el.style.display = 'flex';
        el.style.height = '100%';
    }
}

function showMenu() { 
    hideAllPages();
    const mainApp = document.getElementById('mainApp');
    if(mainApp) mainApp.style.display = 'flex';
    const nameEl = document.getElementById('userProfileName');
    const badgeEl = document.getElementById('userBadgeRole');
    if(nameEl) nameEl.innerText = currentUser.name || currentUser.username || 'พนักงานขาย';
    if(badgeEl) badgeEl.innerText = currentUser.role === 'superadmin' ? '👑 Super Admin' : '🧑‍💼 Staff Agent';
    if(currentUser.role === 'superadmin') {
        showPage('superAdminMenuPage');
    } else { 
        showPage('menuPage');
    } 
}

function goToAdminPage(pageId) {
    hideAllPages();
    showPage(pageId);
    if(pageId === 'staffPage')      loadStaffList();
    if(pageId === 'timeLimitPage')  loadTimeLimits();
    if(pageId === 'checkWinPage') {
        const now = new Date();
        const dateEl = document.getElementById('searchDate2');
        if(dateEl && !dateEl.value) {
            dateEl.value = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
        }
        document.getElementById('winnersResultList2').innerHTML = '';
    }
    if(pageId === 'staffSalesPage') { /* แสดงเมนูย่อย */ }
    if(pageId === 'settingsPage')   { /* แสดงเมนูย่อย */ }
}

function backToAdminMenu() {
    hideAllPages();
    showPage('superAdminMenuPage');
}

function goToColorMode() {
    hideAllPages();
    showPage('colorModePage');
    initColorModeUI();
}

function backFromColorMode() {
    // กลับไปหน้าที่ถูกต้องตาม role
    if(currentUser.role === 'superadmin') {
        goToAdminPage('settingsPage');
    } else {
        showMenu();
    }
}

function goToDashboard() { 
    hideAllPages(); 
    showPage('dashboardPage');
    loadDashboardData();
    if(currentUser.role === 'superadmin') loadPayoutSettings();
}

function backToMenu() { showMenu(); }

function goToBillHistory() {
    hideAllPages();
    showPage('billHistoryPage');
    loadBillHistory();
}

function goToCheckWin() {
    hideAllPages();
    showPage('checkWinStaffPage');
    // set วันที่เป็นวันนี้อัตโนมัติ
    const now = new Date();
    const dateEl = document.getElementById('searchDate');
    if(dateEl && !dateEl.value) {
        dateEl.value = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
    }
    document.getElementById('winnersResultList').innerHTML = '';
}

function goToRecorder() { initRecorderPage(); }

// ⚙️ โหลดอัตราจ่ายรางวัลจาก backend
function loadPayoutSettings() {
    fetch(BACKEND_API_URL, {
        method: "POST", mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "getSettings" })
    })
    .then(res => res.json()).then(data => {
        if(!data.success) return;
        window._payoutSettings = data.settings;
        renderPayoutSettings(data.settings);
    }).catch(err => console.error(err));
}

function renderPayoutSettings(settings) {
    const container = document.getElementById('payoutSettingsContainer');
    if(!container) return;

    const labels = {
        "2ตัว": "🎯 เลข 2 ตัว  (บน/ล่าง/รวม) — จ่ายต่อทุก 1,000 ₭",
        "3ตัว": "🎯 เลข 3 ตัว  (บน/โต๊ด/รวม) — จ่ายต่อทุก 1,000 ₭"
    };
    let html = '';
    Object.entries(labels).forEach(([key, label]) => {
        const val = settings[key] !== undefined ? settings[key] : 0;
        html += `
            <div style="margin-bottom:14px;">
                <label style="font-size:13px; font-weight:600; color:var(--text-muted); display:block; margin-bottom:6px;">${label}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="number" id="rate_${key}" value="${val}" min="0" step="1"
                        style="flex:1; text-align:center; font-size:22px; font-weight:800; color:var(--ios-green); background:#1c2333; border:2px solid var(--ios-green); border-radius:10px; padding:10px;">
                    <span style="font-size:13px; color:var(--text-muted); white-space:nowrap;">× 1K ซื้อ<br>= <strong style="color:var(--ios-green);" id="preview_${key}">${(val*1000).toLocaleString()} ₭</strong></span>
                </div>
            </div>`;
    });
    container.innerHTML = html;

    // preview แบบ real-time
    ["2ตัว","3ตัว"].forEach(key => {
        const input = document.getElementById('rate_' + key);
        const preview = document.getElementById('preview_' + key);
        if(input && preview) {
            input.addEventListener('input', () => {
                const v = parseFloat(input.value) || 0;
                preview.innerText = (v * 1000).toLocaleString() + ' ₭';
            });
        }
    });
}

function savePayoutSettings() {
    const keys = ["2ตัว", "3ตัว"];
    const settings = {};
    keys.forEach(k => {
        const el = document.getElementById('rate_' + k);
        settings[k] = el ? parseFloat(el.value) || 0 : 0;
    });
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: "POST", mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "saveSettings", role: currentUser.role, settings: settings })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        showStatusModal(data.success ? "💎 สำเร็จ" : "❌ ล้มเหลว", data.message, data.success);
    }).catch(err => { showLoading(false); alert(err.toString()); });
}

// ========== 🕐 SERVER CLOCK ENGINE ==========
let _serverTimeOffset = 0;
let _clockSynced = false;
let _clockInterval = null;

// popup หมดเวลา
function showTimeLimitPopup(huayType) {
    const limitStr = huayType === 'ไทย' ? serverTimeLimits.thai : serverTimeLimits.lao;
    let modal = document.getElementById('timeLimitPopup');
    if(!modal) {
        modal = document.createElement('div');
        modal.id = 'timeLimitPopup';
        modal.className = 'modal-backdrop';
        modal.style.zIndex = '1002';
        modal.innerHTML = `
            <div style="background:var(--bg-card); border:2px solid var(--ios-pink); border-radius:20px; padding:28px 24px; width:100%; max-width:320px; text-align:center;">
                <div style="font-size:48px; margin-bottom:12px;">⏰</div>
                <div style="font-size:20px; font-weight:900; color:var(--ios-pink); margin-bottom:8px;">หมดเวลาแล้ว!</div>
                <div id="timeLimitMsg" style="font-size:14px; color:var(--text-muted); margin-bottom:20px;"></div>
                <button onclick="document.getElementById('timeLimitPopup').style.display='none'"
                    style="background:var(--ios-pink); color:#fff; border:none; border-radius:12px; padding:12px 32px; font-size:16px; font-weight:700; cursor:pointer; width:100%;">
                    ตกลง
                </button>
            </div>`;
        document.body.appendChild(modal);
    }
    document.getElementById('timeLimitMsg').innerText = `หวย${huayType} ปิดรับเดิมพันเวลา ${limitStr} น.\nรอรอบถัดไป`;
    modal.style.display = 'flex';
}

function startServerClock() {
    syncServerTime();
    setInterval(syncServerTime, 5 * 60 * 1000);
    // tick ทุก 1 วินาที
    if(_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(() => {
        tickClock();
        // เช็คเตือนใกล้หมดเวลาทุก 1 วินาที แต่ logic เตือนแค่ครั้งเดียวต่อวัน
        if(new Date().getSeconds() === 0) checkNearClosingTime();
    }, 1000);
}

function syncServerTime() {
    const clientSendTime = Date.now();
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"getServerTime" })
    })
    .then(res => res.json()).then(data => {
        if(!data.success) return;
        const clientReceiveTime = Date.now();
        const roundTrip = clientReceiveTime - clientSendTime;
        // คำนวณ offset = server timestamp - client time - ครึ่งหนึ่งของ round trip
        _serverTimeOffset = data.timestamp - clientReceiveTime + (roundTrip / 2);
        _clockSynced = true;
        const statusEl = document.getElementById('serverClockStatus');
        if(statusEl) statusEl.innerText = '✅ server time';
    }).catch(() => {
        const statusEl = document.getElementById('serverClockStatus');
        if(statusEl) statusEl.innerText = '⚠️ ใช้เวลาเครื่อง';
    });
}

function getServerNow() {
    return new Date(Date.now() + _serverTimeOffset);
}

function tickClock() {
    const now = getServerNow();
    const h = now.getHours().toString().padStart(2,'0');
    const m = now.getMinutes().toString().padStart(2,'0');
    const s = now.getSeconds().toString().padStart(2,'0');
    const clockEl = document.getElementById('serverClock');
    if(clockEl) clockEl.innerText = `${h}:${m}:${s}`;
}

// เช็คว่าเลยเวลาขายแล้วหรือยัง
function isTimeLimitExceeded(huayType) {
    const now = getServerNow();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const limitStr = huayType === 'ไทย' ? serverTimeLimits.thai : serverTimeLimits.lao;
    const parts = limitStr.split(':');
    const limitMinutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    return nowMinutes >= limitMinutes;
}

// ========== ⏱️ SESSION TIMEOUT (30 นาที) ==========
let _sessionTimer = null;
let _sessionWarned = false;

function startSessionTimeout() {
    resetSessionTimer();
    // reset timer ทุกครั้งที่มีการแตะหน้าจอ
    ['touchstart','click','keydown'].forEach(evt => {
        document.addEventListener(evt, resetSessionTimer, { passive: true });
    });
}

function resetSessionTimer() {
    _sessionWarned = false;
    if(_sessionTimer) clearTimeout(_sessionTimer);
    // เตือน 5 นาทีก่อนหมด (25 นาที)
    _sessionTimer = setTimeout(() => {
        if(!_sessionWarned) {
            _sessionWarned = true;
            showStatusModal("⚠️ แจ้งเตือน", "ระบบจะออกจากระบบอัตโนมัติใน 5 นาที\nกรุณาแตะหน้าจอเพื่อต่อเวลา", false);
        }
        // logout จริงอีก 5 นาที
        _sessionTimer = setTimeout(() => {
            showStatusModal("🔒 หมดเวลาใช้งาน", "ระบบออกจากระบบอัตโนมัติแล้ว กรุณา login ใหม่", false, () => logout());
        }, 5 * 60 * 1000);
    }, 25 * 60 * 1000);
}

// ========== 🔐 SESSION HEARTBEAT (Single-Session Lock) ==========
let _heartbeatInterval = null;

function startSessionHeartbeat() {
    if(_heartbeatInterval) clearInterval(_heartbeatInterval);
    // ส่ง heartbeat ทุก 2 นาที เพื่อต่ออายุ session lock ใน Sheet
    _heartbeatInterval = setInterval(() => {
        if(!_sessionToken || !currentUser.username) return;
        fetch(BACKEND_API_URL, {
            method: "POST", mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "heartbeat", username: currentUser.username, sessionToken: _sessionToken })
        })
        .then(res => res.json()).then(data => {
            // ถ้า backend บอกว่า session นี้ถูกแย่งแล้ว → force logout
            if(data && data.forceLogout) {
                clearInterval(_heartbeatInterval);
                showStatusModal("🔒 ถูกออกจากระบบ", "มีการเข้าสู่ระบบจากเครื่องอื่น", false, () => {
                    _sessionToken = null;
                    logout();
                });
            }
        }).catch(() => {});
    }, 2 * 60 * 1000);
}

// ========== 🔔 เตือนใกล้หมดเวลาขาย ==========
let _warnedLao = false, _warnedThai = false;

function checkNearClosingTime() {
    const now = getServerNow();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    ['ลาว','ไทย'].forEach(type => {
        const limitStr = type === 'ไทย' ? serverTimeLimits.thai : serverTimeLimits.lao;
        const parts = limitStr.split(':');
        const limitMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        const diff = limitMin - nowMin;
        const warned = type === 'ไทย' ? _warnedThai : _warnedLao;

        if(diff === 15 && !warned) {
            // เตือนล่วงหน้า 15 นาที
            if(type === 'ไทย') _warnedThai = true; else _warnedLao = true;
            showStatusModal("⚠️ ใกล้หมดเวลา!", `หวย${type} จะปิดรับใน 15 นาที (${limitStr} น.)`, false);
        }
        // reset flag เที่ยงคืน
        if(nowMin === 0) { _warnedLao = false; _warnedThai = false; }
    });
}

// ========== SUPER ADMIN FUNCTIONS ==========

// 🏆 บันทึกผลรางวัลลง WinHistory
function saveWinResultToHistory(winNum, position, date, billCount, totalPayout) {
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({
            action: "saveWinResult",
            role: currentUser.role,
            date: date,
            winNum: winNum,
            position: position,
            billCount: billCount,
            totalPayout: totalPayout,
            username: currentUser.username
        })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        showStatusModal(data.success ? "🏆 สำเร็จ" : "❌ ล้มเหลว", data.message, data.success);
    }).catch(err => { showLoading(false); alert(err.toString()); });
}

// 📊 โหลดรายงานการขาย
function loadAdminSalesReport() {
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"loadDashboard", username: currentUser.username, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        if(!data.success) return;
        const now = new Date();
        const toStr  = d => `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
        const todayStr = toStr(now);
        const yest = new Date(now); yest.setDate(yest.getDate()-1);
        const yesterdayStr = toStr(yest);

        let today=0, yesterday=0, week=0, month=0, year=0;
        const staffMap = {};

        (data.rawData||[]).forEach(row => {
            if(row.status === 'ยกเลิก') return;
            const parts = row.date.split('/');
            if(parts.length !== 3) return;
            const rowDate = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
            const diffDays = Math.floor((now - rowDate) / 86400000);

            if(row.date === todayStr)     today     += row.price;
            if(row.date === yesterdayStr) yesterday += row.price;
            if(diffDays <= 6)             week      += row.price;
            if(rowDate.getMonth() === now.getMonth() && rowDate.getFullYear() === now.getFullYear()) month += row.price;
            if(rowDate.getFullYear() === now.getFullYear()) year += row.price;

            // แยกพนักงาน
            const u = row.username || 'ไม่ระบุ';
            if(!staffMap[u]) staffMap[u] = 0;
            staffMap[u] += row.price;
        });

        const fmt = n => n.toLocaleString() + ' ₭';
        const setEl = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
        setEl('rptToday',     fmt(today));
        setEl('rptYesterday', fmt(yesterday));
        setEl('rptWeek',      fmt(week));
        setEl('rptMonth',     fmt(month));
        setEl('rptYear',      fmt(year));
        setEl('rptBills',     data.totalBills + ' บิล');

        // ดึงสถิติคนถูกหวยจาก WinHistory
        fetch(BACKEND_API_URL, {
            method:"POST", mode:"cors",
            headers:{"Content-Type":"text/plain;charset=utf-8"},
            body: JSON.stringify({ action:"getWinHistory" })
        })
        .then(res => res.json()).then(win => {
            if(!win.success) return;
            const w = n => n + ' คน';
            const el = id => document.getElementById(id);
            if(el('winToday'))     el('winToday').innerText     = w(win.today);
            if(el('winYesterday')) el('winYesterday').innerText = w(win.yesterday);
            if(el('winWeek'))      el('winWeek').innerText      = w(win.week);
            if(el('winMonth'))     el('winMonth').innerText     = w(win.month);
        }).catch(err => console.error(err));
    }).catch(err => console.error(err));
}

// 👥 โหลดรายชื่อพนักงาน
function loadStaffList() {
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"getUsernames" })
    })
    .then(res => res.json()).then(data => {
        const container = document.getElementById('staffListContainer');
        if(!data.users || data.users.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted); text-align:center;">ยังไม่มีพนักงานในระบบ</p>`;
            return;
        }
        container.innerHTML = data.users.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-color);">
                <span style="font-weight:700; font-size:15px;">👤 ${u}</span>
                <div style="display:flex; gap:8px;">
                    <button onclick="openEditStaff('${u}')" style="background:var(--ios-blue); color:#fff; border:none; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:700; cursor:pointer;">✏️ แก้ PIN</button>
                    <button onclick="deleteStaff('${u}')" style="background:var(--ios-pink); color:#fff; border:none; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:700; cursor:pointer;">🗑️ ลบ</button>
                </div>
            </div>`).join('');
    }).catch(err => console.error(err));
}

function openAddStaffModal() {
    document.getElementById('staffModalTitle').innerText = '➕ เพิ่มพนักงานใหม่';
    document.getElementById('staffNameInput').value = '';
    document.getElementById('staffPinInput').value = '';
    document.getElementById('staffNameInput').removeAttribute('readonly');
    document.getElementById('staffEditMode').value = 'add';
    document.getElementById('staffModal').style.display = 'flex';
}

function openEditStaff(name) {
    document.getElementById('staffModalTitle').innerText = `✏️ แก้ไข PIN — ${name}`;
    document.getElementById('staffNameInput').value = name;
    document.getElementById('staffNameInput').setAttribute('readonly', true);
    document.getElementById('staffPinInput').value = '';
    document.getElementById('staffEditMode').value = 'edit';
    document.getElementById('staffModal').style.display = 'flex';
}

function submitStaffForm() {
    const name = document.getElementById('staffNameInput').value.trim();
    const pin  = document.getElementById('staffPinInput').value.trim();
    const mode = document.getElementById('staffEditMode').value;
    if(!name) { alert('⚠️ กรุณากรอกชื่อพนักงาน'); return; }
    if(!pin || pin.length !== 4) { alert('⚠️ PIN ต้องเป็นตัวเลข 4 หลัก'); return; }

    showLoading(true);
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"manageStaff", mode, name, pin, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        document.getElementById('staffModal').style.display = 'none';
        showStatusModal(data.success ? "💎 สำเร็จ" : "❌ ล้มเหลว", data.message, data.success, () => loadStaffList());
    }).catch(err => { showLoading(false); alert(err.toString()); });
}

function deleteStaff(name) {
    if(!confirm(`⚠️ ลบพนักงาน "${name}" ออกจากระบบ?\nข้อมูลการขายจะยังคงอยู่`)) return;
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"manageStaff", mode:"delete", name, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        showStatusModal(data.success ? "💎 สำเร็จ" : "❌ ล้มเหลว", data.message, data.success, () => loadStaffList());
    }).catch(err => { showLoading(false); alert(err.toString()); });
}

// ⏰ โหลด/บันทึกเวลา
function loadTimeLimitsFromServer() {
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"getTimeLimits" })
    })
    .then(res => res.json()).then(data => {
        if(data.success) {
            serverTimeLimits.lao  = data.lao  || "20:15";
            serverTimeLimits.thai = data.thai || "15:15";
            // อัปเดต UI ถ้าหน้าปรับเวลาเปิดอยู่
            const laoEl  = document.getElementById('timeLao');
            const thaiEl = document.getElementById('timeThai');
            if(laoEl)  laoEl.value  = serverTimeLimits.lao;
            if(thaiEl) thaiEl.value = serverTimeLimits.thai;
        }
    }).catch(err => console.error(err));
}

function loadTimeLimits() {
    loadTimeLimitsFromServer();
}

function saveTimeLimits() {
    const lao  = document.getElementById('timeLao').value;
    const thai = document.getElementById('timeThai').value;
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"saveTimeLimits", role: currentUser.role, lao, thai })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        if(data.success) {
            serverTimeLimits.lao  = lao;
            serverTimeLimits.thai = thai;
        }
        showStatusModal(data.success ? "💎 สำเร็จ" : "❌ ล้มเหลว", data.message, data.success);
    }).catch(err => { showLoading(false); alert(err.toString()); });
}

// 🔍 ตรวจหวย Super Admin (ใช้ ID ชุดที่ 2)
function executeSearchWinners2() {
    const winNum    = document.getElementById('searchWinNum2').value.trim();
    const posFilter = document.getElementById('searchPosition2').value;
    const dateStr   = document.getElementById('searchDate2').value;
    if(!winNum || !dateStr) { alert("กรุณาใส่เลขรางวัลและเลือกวันที่"); return; }
    const parts = dateStr.split("-");
    const formattedDate = `${parseInt(parts[2])}/${parseInt(parts[1])}/${parseInt(parts[0])}`;
    highlightWinningNum = winNum;
    highlightPositionFilter = posFilter;
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method:"POST", mode:"cors",
        headers:{"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({ action:"checkWinners", winningNum:winNum, positionFilter:posFilter, targetDate:formattedDate, username:currentUser.username, role:currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        const div = document.getElementById('winnersResultList2');
        div.innerHTML = "";
        if(!data.success || data.data.length === 0) {
            div.innerHTML = `<div class="card" style="text-align:center; padding:20px; color:var(--text-muted);">📭 ไม่พบรายการถูกรางวัล</div>`;
            return;
        }
        const billMap = {};
        let grandTotal = 0;
        data.data.forEach(w => {
            grandTotal += w.winAmount;
            if(!billMap[w.billId]) billMap[w.billId] = { billId:w.billId, username:w.username, date:w.date, items:[], totalWin:0 };
            billMap[w.billId].items.push(w);
            billMap[w.billId].totalWin += w.winAmount;
        });
        window._winnerBillMap = billMap;
        let html = '';
        Object.values(billMap).forEach((bill, idx) => {
            let itemsHtml = bill.items.map(w => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; border-radius:8px; background:rgba(48,209,88,0.15); border:1px solid rgba(48,209,88,0.3); margin-bottom:4px;">
                    <span><strong style="font-size:18px; background:var(--ios-green); color:#fff; padding:1px 8px; border-radius:6px;">🎯 ${w.num}</strong> <small style="color:var(--text-muted);">[${w.position}]</small></span>
                    <span style="color:var(--ios-green); font-weight:800;">💸 ${w.winAmount.toLocaleString()} ₭</span>
                </div>`).join('');
            html += `
                <div class="card" style="border:2px solid rgba(48,209,88,0.4); margin-bottom:10px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div>
                            <div style="font-size:11px; color:var(--ios-blue); font-weight:700;">
                                <span style="background:var(--ios-blue); color:#fff; border-radius:50%; width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; margin-right:4px;">${idx+1}</span>
                                ${bill.billId}
                            </div>
                            <div style="font-size:12px; color:var(--text-muted);">👤 ${bill.username} | 📅 ${bill.date}</div>
                        </div>
                        <button onclick="openWinnerSlip('${bill.billId}')" style="background:var(--ios-blue); color:#fff; border:none; border-radius:10px; padding:8px 14px; font-size:13px; font-weight:700; cursor:pointer;">🧾 ดูใบบิน</button>
                    </div>
                    ${itemsHtml}
                    <div style="text-align:right; padding-top:6px; border-top:1px dashed var(--border-color); font-size:14px; font-weight:800; color:var(--ios-green);">รวมรางวัลบิลนี้: ${bill.totalWin.toLocaleString()} ₭</div>
                </div>`;
        });
        html += `<div style="padding:12px; background:rgba(48,209,88,0.2); border-radius:12px; text-align:center; font-weight:900; color:var(--ios-green); font-size:18px; border:2px solid rgba(48,209,88,0.5);">💰 รวมยอดรางวัลทั้งหมด: ${grandTotal.toLocaleString()} ₭</div>`;
        
        const totalBills2 = Object.keys(billMap).length;
        const winNum2  = document.getElementById('searchWinNum2').value.trim();
        const posFilter2 = document.getElementById('searchPosition2').value;
        html += `
        <button onclick="saveWinResultToHistory('${winNum2}','${posFilter2}','${formattedDate}',${totalBills2},${grandTotal})"
            style="width:100%; background:#15803d; color:#fff; border:none; border-radius:12px; padding:14px; font-size:15px; font-weight:700; cursor:pointer; margin-top:8px;">
            ✅ บันทึกผลรางวัลวันนี้ลงประวัติ
        </button>`;
        div.innerHTML = html;
    }).catch(err => { showLoading(false); alert(err.toString()); });
}
// 📈 วาดกราฟยอดขาย 7 วันย้อนหลัง
let _salesChartInstance = null;
function renderSalesChart(rawData) {
    const canvas = document.getElementById('salesChart');
    const emptyEl = document.getElementById('salesChartEmpty');
    if(!canvas) return;

    // สร้าง 7 วันย้อนหลัง
    const days = [];
    const sales = [];
    const now = new Date();
    for(let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const label = `${d.getDate()}/${d.getMonth()+1}`;
        const dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
        days.push(label);
        const total = rawData.filter(r => r.date === dateStr && r.status !== 'ยกเลิก').reduce((s,r) => s + r.price, 0);
        sales.push(total);
    }

    const hasData = sales.some(v => v > 0);
    if(!hasData) {
        canvas.style.display = 'none';
        if(emptyEl) emptyEl.style.display = 'block';
        return;
    }
    canvas.style.display = 'block';
    if(emptyEl) emptyEl.style.display = 'none';

    // ลบกราฟเก่าถ้ามี
    if(_salesChartInstance) { _salesChartInstance.destroy(); _salesChartInstance = null; }

    const max = Math.max(...sales);
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth || 300;
    canvas.height = 160;

    const W = canvas.width, H = canvas.height;
    const padL = 12, padR = 12, padT = 16, padB = 28;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const barW = chartW / days.length * 0.6;
    const gap = chartW / days.length;

    ctx.clearRect(0, 0, W, H);

    days.forEach((label, i) => {
        const x = padL + i * gap + gap * 0.2;
        const barH = max > 0 ? (sales[i] / max) * chartH : 0;
        const y = padT + chartH - barH;
        const isToday = i === 6;

        // แท่ง
        ctx.fillStyle = isToday ? '#0a84ff' : '#1c3a5e';
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 4);
        ctx.fill();

        // label วัน
        ctx.fillStyle = '#8e8e93';
        ctx.font = '10px Noto Sans Thai, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + barW/2, H - 8);

        // ยอด
        if(sales[i] > 0) {
            const kval = sales[i] >= 1000 ? Math.round(sales[i]/1000) + 'K' : sales[i];
            ctx.fillStyle = isToday ? '#0a84ff' : '#8e8e93';
            ctx.font = '9px Noto Sans Thai, sans-serif';
            ctx.fillText(kval, x + barW/2, y - 4);
        }
    });
}

// ========== 🎨 COLOR MODE ==========
let _currentColorMode = localStorage.getItem('appColorMode') || 'dark';

function initColorModeUI() {
    ['light','dark','auto'].forEach(mode => {
        const el = document.getElementById('mode' + mode.charAt(0).toUpperCase() + mode.slice(1));
        if(!el) return;
        const isActive = _currentColorMode === mode;
        el.style.border = isActive ? '2px solid var(--ios-blue)' : '2px solid var(--border-color)';
        el.style.background = isActive ? 'rgba(10,132,255,0.1)' : 'transparent';
        el.querySelector('div:last-child').style.color = isActive ? 'var(--ios-blue)' : 'var(--text-main)';
    });
}

function setAppColorMode(mode) {
    _currentColorMode = mode;
    localStorage.setItem('appColorMode', mode);
    applyColorMode(mode);
    initColorModeUI();
    showStatusModal('✅ บันทึกแล้ว', `เปลี่ยนเป็นโหมด ${mode === 'light' ? 'สว่าง ☀️' : mode === 'dark' ? 'มืด 🌙' : 'Auto 🔄'} แล้ว`, true);
}

function applyColorMode(mode) {
    const root = document.documentElement;
    if(mode === 'light') {
        root.style.setProperty('--bg-main',    '#f0f4f8');
        root.style.setProperty('--bg-card',    '#ffffff');
        root.style.setProperty('--border-color','#d1d9e0');
        root.style.setProperty('--text-main',  '#0f172a');
        root.style.setProperty('--text-muted', '#64748b');
        root.style.setProperty('--chip-bg',    '#e2e8f0');  // ✅ chip สว่าง อ่านออก
        document.body.style.background = '#f0f4f8';
        _applyInputColors('#e8edf2', '#0f172a', '#c5cdd6');
    } else if(mode === 'dark') {
        root.style.setProperty('--bg-main',    '#1a0806');
        root.style.setProperty('--bg-card',    '#2d1108');
        root.style.setProperty('--border-color','#5a2210');
        root.style.setProperty('--text-main',  '#f5e6c8');
        root.style.setProperty('--text-muted', '#c4883a');
        root.style.setProperty('--chip-bg',    '#3a1508');
        document.body.style.background = '#1a0806';
        _applyInputColors('#3a1508', '#f5e6c8', '#5a2210');
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyColorMode(prefersDark ? 'dark' : 'light');
    }
}

function _applyInputColors(bg, color, border) {
    const style = document.getElementById('_dynamicInputStyle') || (() => {
        const s = document.createElement('style');
        s.id = '_dynamicInputStyle';
        document.head.appendChild(s);
        return s;
    })();
    style.textContent = `
        input, select, textarea {
            background: ${bg} !important;
            color: ${color} !important;
            border-color: ${border} !important;
        }
        input::placeholder { color: ${color}88 !important; }
        select option { background: ${bg}; color: ${color}; }
    `;
}

// Auto mode listener
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if(_currentColorMode === 'auto') applyColorMode('auto');
});

// Apply on load
applyColorMode(_currentColorMode);

// ========== 🔐 CHANGE ADMIN PASSWORD ==========
function changeAdminPassword() {
    const oldPass    = document.getElementById('oldAdminPass').value.trim();
    const newPass    = document.getElementById('newAdminPass').value.trim();
    const confirmPass = document.getElementById('confirmAdminPass').value.trim();

    if(!oldPass || !newPass || !confirmPass) {
        showStatusModal('⚠️ แจ้งเตือน', 'กรุณากรอกรหัสผ่านให้ครบทุกช่อง', false);
        return;
    }
    if(newPass !== confirmPass) {
        showStatusModal('❌ ผิดพลาด', 'รหัสผ่านใหม่ไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง', false);
        return;
    }
    if(newPass.length < 6) {
        showStatusModal('❌ ผิดพลาด', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร', false);
        return;
    }
    showLoading(true);
    fetch(BACKEND_API_URL, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'changeAdminPassword', oldPass, newPass, role: currentUser.role })
    })
    .then(res => res.json()).then(data => {
        showLoading(false);
        showStatusModal(data.success ? '✅ สำเร็จ' : '❌ ล้มเหลว', data.message, data.success);
        if(data.success) {
            document.getElementById('oldAdminPass').value = '';
            document.getElementById('newAdminPass').value = '';
            document.getElementById('confirmAdminPass').value = '';
        }
    }).catch(err => { showLoading(false); showStatusModal('❌ ล้มเหลว', err.toString(), false); });
}