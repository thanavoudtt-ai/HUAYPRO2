// ========== CONFIG ==========
const SPREADSHEET_ID = "1QIwNCJ0xLEuS-9qfTkucSbTt29F9pvnzzblu3boo-Qc";
const SHEET_DATA = "Base Huay2";   
const SHEET_SUPER_ADMIN = "Super Admin"; 
const SHEET_CUSTOMER = "Customer"; 
const SHEET_TAMRA = "ຕຳລາຝັນ";
const SHEET_SETTINGS = "Settings";
const SHEET_WIN_HISTORY = "WinHistory";
const SHEET_SESSIONS = "Sessions"; // ✅ เพิ่มใหม่: เก็บ session lock

function doGet(e) {
  return HtmlService.createHtmlOutput("Web App is running successfully!");
}

// 🌐 ฟังก์ชันรับค่าจากหน้าบ้าน (POST API) - รูปแบบเสถียรขจัดปัญหา CORS ค้าง
function doPost(e) {
  const createResponse = (obj) => {
    return ContentService.createTextOutput(JSON.stringify(obj))
                         .setMimeType(ContentService.MimeType.JSON);
  };

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createResponse({ success: false, message: "❌ ไม่มีข้อมูลส่งมายังเซิร์ฟเวอร์" });
    }

    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // 1. ดึงรายชื่อจากหน้า Customer ไปใส่ใน Dropdown หน้าบ้าน
    if (action === "getUsernames") {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_CUSTOMER);
      if (!sheet) return createResponse({ users: [] });
      
      const values = sheet.getDataRange().getDisplayValues();
      let users = [];
      for (let i = 1; i < values.length; i++) {
        // Sheet ใหม่: [0]=NAME [1]=PIN
        if (values[i][0] && values[i][0].toString().trim() !== "") {
          users.push(values[i][0].toString().trim());
        }
      }
      users = [...new Set(users)];
      return createResponse({ users: users });
    }

    // 2. การล็อกอินรวมศูนย์ความปลอดภัยสูง (Unified Login)
    if (action === "login") {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      
      // ล็อกอินในโหมด แอดมินสูงสุด
      if (data.role === "superadmin" || data.password) {
        const adminSheet = ss.getSheetByName(SHEET_SUPER_ADMIN);
        if (!adminSheet) return createResponse({ success: false, message: "❌ ไม่พบหน้าแผ่นงาน Super Admin" });
        
        const adminData = adminSheet.getDataRange().getDisplayValues();
        const inputUser = data.username ? data.username.toString().trim().toLowerCase() : "";
        const inputPass = data.password ? data.password.toString().trim() : "";
        
        for (let i = 0; i < adminData.length; i++) {
          const rowUser = adminData[i][0] ? adminData[i][0].toString().trim().toLowerCase() : "";
          const rowPass = adminData[i][1] ? adminData[i][1].toString().trim() : adminData[i][0].toString().trim();
          // ถ้า Sheet มีแค่ 1 คอลัมน์ (password เดิม) ให้ตรวจแค่ password
          const hasUsername = adminData[i].length > 1 && adminData[i][1];
          if (hasUsername) {
            if (rowUser === inputUser && rowPass === inputPass) {
              return createResponse({ success: true, role: "superadmin", username: "ผู้ดูแลระบบสูงสุด", name: "ผู้ดูแลระบบสูงสุด" });
            }
          } else {
            // backward compat: ถ้า Sheet มีแค่คอลัมน์เดียว ตรวจแค่ password
            if (rowUser === inputPass) {
              return createResponse({ success: true, role: "superadmin", username: "ผู้ดูแลระบบสูงสุด", name: "ผู้ดูแลระบบสูงสุด" });
            }
          }
        }
        return createResponse({ success: false, message: "❌ Username หรือรหัสผ่านไม่ถูกต้อง!" });
      } 
      
      // ล็อกอินในโหมด พนักงานทั่วไป
      else {
        const staffSheet = ss.getSheetByName(SHEET_CUSTOMER);
        if (!staffSheet) return createResponse({ success: false, message: "❌ ไม่พบหน้าแผ่นงาน Customer" });
        
        const staffData = staffSheet.getDataRange().getDisplayValues();
        const inputUser = data.username ? data.username.toString().trim().toLowerCase() : "";
        const inputPin = data.pin ? data.pin.toString().trim() : "";
        
        if (inputUser === "" || inputPin === "") {
          return createResponse({ success: false, message: "❌ กรุณากรอกชื่อและรหัส PIN ให้ครบถ้วน" });
        }
        
        // Sheet ใหม่: [0]=NAME [1]=PIN
        for (let i = 1; i < staffData.length; i++) {
          if (staffData[i][0]) {
            const dbName = staffData[i][0].toString().trim().toLowerCase();
            const dbPin  = staffData[i][1] ? staffData[i][1].toString().trim() : "";
            
            if (dbName === inputUser && dbPin === inputPin) {
              const displayName = staffData[i][0].toString().trim();

              // ✅ ตรวจ single-session lock
              const sessionCheck = checkAndLockSession(ss, displayName);
              if (!sessionCheck.allowed) {
                return createResponse({ success: false, message: sessionCheck.message });
              }

              return createResponse({ 
                success: true, 
                role: "staff", 
                username: displayName,
                name: displayName,
                sessionToken: sessionCheck.token
              });
            }
          }
        }
        return createResponse({ success: false, message: "❌ ชื่อหรือรหัส PIN ไม่ถูกต้อง!" });
      }
    }

    // 3. บันทึกข้อมูลบิลลงฐานข้อมูล
    if (action === "saveBill") {
      return createResponse(saveBillData(data));
    }

    // 4. ดึงสถิติหน้าแดชบอร์ดรายงาน
    if (action === "loadDashboard") {
      return createResponse(getDashboardStats(data.username, data.role));
    }

    // 5. ค้นหาประวัติบิลรายรหัส
    if (action === "searchBills") {
      return createResponse(searchBillsData(data.billId, data.username, data.role));
    }

    // 6. สั่งยกเลิกบิลคืนเงิน
    if (action === "cancelBill") {
      return createResponse(cancelBillById(data.billId, data.username, data.role));
    }

    // 7. สแกนประวัติการตรวจเช็คผู้โชคดี
    if (action === "checkWinners") {
      const winners = checkWinners(data.winningNum, data.targetDate, data.username, data.role, data.positionFilter);
      return createResponse({ success: true, data: winners });
    }

    // 8. เรียกข้อมูลตำราฝัน
    if (action === "getTamra") {
      return createResponse({ success: true, data: getTamraData() });
    }

    // 9. ดึงอัตราจ่ายรางวัล
    if (action === "getSettings") {
      return createResponse({ success: true, settings: getPayoutSettings() });
    }

    // 10. บันทึกอัตราจ่ายรางวัล (เฉพาะ superadmin)
    if (action === "saveSettings") {
      if (data.role !== "superadmin") return createResponse({ success: false, message: "❌ ไม่มีสิทธิ์" });
      return createResponse(savePayoutSettings(data.settings));
    }

    // 11. จัดการพนักงาน (เฉพาะ superadmin)
    if (action === "manageStaff") {
      if (data.role !== "superadmin") return createResponse({ success: false, message: "❌ ไม่มีสิทธิ์" });
      return createResponse(manageStaffData(data.mode, data.name, data.pin));
    }

    // 12. บันทึกผลรางวัลลง WinHistory
    if (action === "saveWinResult") {
      if (data.role !== "superadmin") return createResponse({ success: false, message: "❌ ไม่มีสิทธิ์" });
      return createResponse(saveWinResult(data.date, data.winNum, data.position, data.billCount, data.totalPayout, data.username));
    }

    // 13. ดึงสถิติคนถูกหวยจาก WinHistory
    if (action === "getWinHistory") {
      return createResponse(getWinHistory());
    }

    // 14. ดึงเวลาจริงจาก Server
    if (action === "getServerTime") {
      const now = new Date();
      const tz = Session.getScriptTimeZone();
      return createResponse({
        success: true,
        time: Utilities.formatDate(now, tz, "HH:mm:ss"),
        date: Utilities.formatDate(now, tz, "d/M/yyyy"),
        hour: parseInt(Utilities.formatDate(now, tz, "HH")),
        minute: parseInt(Utilities.formatDate(now, tz, "mm")),
        second: parseInt(Utilities.formatDate(now, tz, "ss")),
        timestamp: now.getTime()
      });
    }

    // 15. บันทึกเวลาปิดขายลง Settings Sheet
    if (action === "saveTimeLimits") {
      if (data.role !== "superadmin") return createResponse({ success: false, message: "❌ ไม่มีสิทธิ์" });
      return createResponse(saveTimeLimitsToSheet(data.lao, data.thai));
    }

    // 16. ดึงเวลาปิดขายจาก Settings Sheet
    if (action === "getTimeLimits") {
      return createResponse(getTimeLimitsFromSheet());
    }

    // 17. เปลี่ยนรหัสผ่าน Super Admin
    if (action === "changeAdminPassword") {
      if (data.role !== "superadmin") return createResponse({ success: false, message: "❌ ไม่มีสิทธิ์" });
      return createResponse(changeAdminPasswordData(data.oldPass, data.newPass));
    }

    // 18. Heartbeat — ต่ออายุ session lock
    if (action === "heartbeat") {
      return createResponse(heartbeatSession(data.username, data.sessionToken));
    }

    // 19. Unlock session — เมื่อ logout
    if (action === "unlockSession") {
      return createResponse(unlockSession(data.username, data.sessionToken));
    }

    return createResponse({ success: false, message: "ไม่พบ Action ที่ระบุ" });

  } catch (error) {
    return createResponse({ success: false, message: "Backend error: " + error.toString() });
  }
}

// 👑 ฟังก์ชันสแกนหาผู้โชคดีดึงข้อมูลครบถ้วน
function checkWinners(winningNum, targetDate, username, role, positionFilter) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_DATA);
    if (!sheet) return [];

    // ดึงอัตราจ่ายจาก Settings
    const rates = getPayoutSettings();

    const data = sheet.getDataRange().getValues();
    let winnersMap = {};

    const cleanWinningNum = winningNum.toString().trim();
    const cleanFilter = positionFilter ? positionFilter.toString().trim() : "ทั้งหมด";
    const cleanUser = username.toString().trim().toLowerCase();

    let cleanTargetDate = targetDate.toString().trim();
    cleanTargetDate = cleanTargetDate.replace(/^(\d+)\/0*(\d+)\/(\d+)$/, "$1/$2/$3");
    if (cleanTargetDate.includes("/2569")) cleanTargetDate = cleanTargetDate.replace("/2569", "/2026");
    if (cleanTargetDate.includes("/2570")) cleanTargetDate = cleanTargetDate.replace("/2570", "/2027");

    for (let i = 1; i < data.length; i++) {
      let rowUser   = data[i][3] ? data[i][3].toString().trim().toLowerCase() : "";
      let rowStatus = data[i][9] ? data[i][9].toString().trim() : "ปกติ";

      if (rowStatus === "ยกเลิก") continue;
      if (role !== 'superadmin' && rowUser !== cleanUser) continue;

      let rowDateRaw = data[i][1];
      let rowDateStr = "";
      if (rowDateRaw instanceof Date) {
        rowDateStr = Utilities.formatDate(rowDateRaw, Session.getScriptTimeZone(), "d/M/yyyy");
      } else {
        rowDateStr = rowDateRaw.toString().trim();
      }
      if (rowDateStr !== cleanTargetDate) continue;

      let billId = data[i][0] ? data[i][0].toString().trim() : "ไม่มีเลขบิล";
      let num    = data[i][5] ? data[i][5].toString().trim() : "";
      let pos    = data[i][6] ? data[i][6].toString().trim() : "";
      let price  = parseFloat(data[i][7]) || 0;

      if (cleanFilter !== "ทั้งหมด" && pos !== cleanFilter) continue;
      if (num !== cleanWinningNum) continue;
      if (pos !== "บน" && pos !== "ล่าง" && pos !== "โต๊ด" && pos !== "รวม") continue;

      // คำนวณอัตราจ่าย: แค่ 2ตัว หรือ 3ตัว ไม่สนตำแหน่ง
      let numLen  = num.length;
      let rateKey = numLen + "ตัว";  // "2ตัว" หรือ "3ตัว"
      let rate    = rates[rateKey] || 0;
      let winAmt  = price * rate;

      let key = billId + "_" + num + "_" + pos;
      if (!winnersMap[key]) {
        winnersMap[key] = {
          date: rowDateStr,
          username: data[i][3] ? data[i][3].toString().trim() : "ไม่ระบุ",
          billId: billId,
          num: num,
          position: pos,
          price: 0,
          rate: rate,
          winAmount: 0
        };
      }
      winnersMap[key].price     += price;
      winnersMap[key].winAmount += winAmt;
    }

    let result = [];
    for (let k in winnersMap) { result.push(winnersMap[k]); }
    return result;
  } catch(e) {
    return [];
  }
}

// 📚 ฟังก์ชันดึงข้อมูลสมุดตำราฝันลาวโบราณ
function getTamraData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_TAMRA);
    if (!sheet) return [];
    const data = sheet.getDataRange().getDisplayValues();
    let list = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] || data[i][1]) {
        list.push({
          num: data[i][0] ? data[i][0].toString().trim() : "",
          name: data[i][1] ? data[i][1].toString().trim() : ""
        });
      }
    }
    return list;
  } catch(e) {
    return [];
  }
}

// 📝 ฟังก์ชันบันทึกข้อมูลโพยหวยลงแผ่นงานหลัก
function saveBillData(payload) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_DATA);
    if (!sheet) return { success: false, message: "❌ ไม่พบหน้าแผ่นงานเก็บข้อมูลหวย" };
    
    const items = payload.items;
    const now = new Date();
    
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      // Sheet เก็บวันที่เป็น ค.ศ. ตรงๆ ไม่ต้องแปลงปี
      let targetDateStr = item.date;
      
      // บันทึกตาม column จริง: A=BillID B=วันที่ C=เวลา D=พนักงาน E=ลูกค้า F=เลข G=ตำแหน่ง H=ราคา I=ประเภท
      sheet.appendRow([
        payload.billId,          // A: Bill ID
        targetDateStr,           // B: วันที่งวด
        Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss"), // C: เวลา
        payload.username,        // D: พนักงาน
        payload.customer || "",  // E: ลูกค้า
        item.num.toString(),     // F: เลข
        item.position,           // G: ตำแหน่ง
        parseFloat(item.price),  // H: ราคา
        item.type                // I: ประเภท (ลาว/ไทย)
      ]);
    }
    return { success: true, message: "🎉 บันทึกข้อมูลโพยบิลสำเร็จเรียบร้อยแล้ว!" };
  } catch(e) {
    return { success: false, message: "เกิดข้อผิดพลาดในการบันทึก: " + e.toString() };
  }
}

// 📊 ฟังก์ชันรวบรวมรายงานสถิติหน้าแดชบอร์ด
function getDashboardStats(username, role) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_DATA);
    if (!sheet) return { success: false, totalSales: 0, totalBills: 0, activeBills: 0, canceledBills: 0, rawData: [] };
    
    const data = sheet.getDataRange().getValues();
    let totalSales = 0;
    let billSet = new Set();
    let activeBillSet = new Set();
    let canceledBillSet = new Set();
    let userBills = [];
    
    const cleanUser = username ? username.toString().trim().toLowerCase() : "";
    
    // 📋 โครงสร้าง Sheet "Base Huay2":
    // [0]=BillID [1]=วันที่ [2]=เวลา [3]=พนักงาน [4]=ลูกค้า [5]=เลข [6]=ตำแหน่ง [7]=ราคา [8]=ประเภท [9]=สถานะ
    for (let i = 1; i < data.length; i++) {
      let rowUser = data[i][3] ? data[i][3].toString().trim().toLowerCase() : "";
      let status = data[i][9] ? data[i][9].toString().trim() : "ปกติ";
      
      if (role !== 'superadmin' && rowUser !== cleanUser) continue;
      
      let billId = data[i][0] ? data[i][0].toString().trim() : "";
      let price = parseFloat(data[i][7]) || 0;
      
      if (billId !== "") {
        billSet.add(billId);
        if (status === "ยกเลิก") {
          canceledBillSet.add(billId);
        } else {
          activeBillSet.add(billId);
          totalSales += price;
        }
      }
      
      let dateVal = data[i][1];
      let dateString = "";
      if (dateVal instanceof Date) {
        dateString = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "d/M/yyyy");
      } else {
        dateString = dateVal.toString().trim();
      }
      
      userBills.push({
        date: dateString,
        billId: billId,
        username: data[i][3] ? data[i][3].toString() : "",
        num: data[i][5] ? data[i][5].toString() : "",
        position: data[i][6] ? data[i][6].toString() : "",
        price: price,
        type: data[i][8] ? data[i][8].toString() : "",
        status: status
      });
    }
    
    return {
      success: true,
      totalSales: totalSales,
      totalBills: billSet.size,
      activeBills: activeBillSet.size,
      canceledBills: canceledBillSet.size,
      rawData: userBills.reverse()
    };
  } catch (e) {
    return { success: false, totalSales: 0, totalBills: 0, activeBills: 0, canceledBills: 0, rawData: [] };
  }
}

// 🔍 ฟังก์ชันดึงรายละเอียดภายในบิลเดี่ยว
function searchBillsData(billId, username, role) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_DATA);
    if (!sheet) return { success: false, message: "ไม่พบแผ่นงานข้อมูล" };
    
    const data = sheet.getDataRange().getValues();
    const targetBillId = billId.toString().trim();
    const cleanUser = username ? username.toString().trim().toLowerCase() : "";
    let items = [];
    let billStatus = "ปกติ";
    let billUser = "";
    
    // 📋 โครงสร้าง: [0]=BillID [1]=วันที่ [2]=เวลา [3]=พนักงาน [4]=ลูกค้า [5]=เลข [6]=ตำแหน่ง [7]=ราคา [8]=ประเภท [9]=สถานะ
    for (let i = 1; i < data.length; i++) {
      let rowBillId = data[i][0] ? data[i][0].toString().trim() : "";
      let rowUser = data[i][3] ? data[i][3].toString().trim().toLowerCase() : "";
      
      if (rowBillId === targetBillId) {
        if (role !== "superadmin" && rowUser !== cleanUser) continue;
        
        billStatus = data[i][9] ? data[i][9].toString().trim() : "ปกติ";
        billUser = data[i][3] ? data[i][3].toString().trim() : "";
        
        let dateVal = data[i][1];
        let dateString = "";
        if (dateVal instanceof Date) {
          dateString = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "d/M/yyyy");
        } else {
          dateString = dateVal.toString().trim();
        }
        
        items.push({
          date: dateString,
          num: data[i][5] ? data[i][5].toString() : "",
          position: data[i][6] ? data[i][6].toString() : "",
          price: parseFloat(data[i][7]) || 0,
          type: data[i][8] ? data[i][8].toString() : ""
        });
      }
    }
    
    if (items.length === 0) {
      return { success: false, message: "❌ ไม่พบเลขบิลนี้ในระบบ หรือท่านไม่มีสิทธิ์จัดการบิลนี้" };
    }
    
    return { success: true, billId: targetBillId, status: billStatus, username: billUser, items: items };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// ❌ ฟังก์ชันเปลี่ยนสถานะบิลเป็นยกเลิก
function cancelBillById(billId, username, role) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_DATA);
    if (!sheet) return { success: false, message: "ไม่พบหน้าแผ่นงานข้อมูล" };
    
    const data = sheet.getDataRange().getValues();
    const targetBillId = billId.toString().trim();
    const cleanUser = username ? username.toString().trim().toLowerCase() : "";
    let updatedCount = 0;
    
    // 📋 โครงสร้าง: [0]=BillID [3]=พนักงาน [9]=สถานะ
    for (let i = 1; i < data.length; i++) {
      let rowBillId = data[i][0] ? data[i][0].toString().trim() : "";
      let rowUser = data[i][3] ? data[i][3].toString().trim().toLowerCase() : "";
      
      if (rowBillId === targetBillId) {
        if (role !== "superadmin" && rowUser !== cleanUser) {
          return { success: false, message: "❌ คุณไม่มีสิทธิ์ยกเลิกบิลของผู้อื่น" };
        }
        sheet.getRange(i + 1, 10).setValue("ยกเลิก");
        updatedCount++;
      }
    }
    
    if (updatedCount > 0) {
      return { success: true, message: `✅ ทำการยกเลิกบิลเลขที่ ${targetBillId} เรียบร้อยแล้ว!` };
    }
    return { success: false, message: "❌ ไม่พบเลขบิลที่ต้องการยกเลิก" };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// ========================================
// 🔧 รันฟังก์ชันนี้ครั้งเดียวใน Apps Script
// เพื่อสร้าง Sheet "Settings" พร้อมค่า default
// ========================================
function setupSettings() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (sheet) { ss.deleteSheet(sheet); } // ลบของเก่าออกก่อน
  sheet = ss.insertSheet(SHEET_SETTINGS);
  
  const headers = [["ประเภท", "อัตราจ่าย (ต่อ 1K)"]];
  const defaults = [
    ["2ตัว", 70],   // 2 ตัว ทุกตำแหน่ง ซื้อ 1K ได้ 70K
    ["3ตัว", 500]   // 3 ตัว ทุกตำแหน่ง ซื้อ 1K ได้ 500K
  ];
  
  sheet.getRange(1, 1, 1, 2).setValues(headers);
  sheet.getRange(2, 1, defaults.length, 2).setValues(defaults);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#0a84ff").setFontColor("#ffffff");
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 180);
  
  SpreadsheetApp.getUi().alert("✅ สร้าง Settings Sheet สำเร็จแล้ว!");
}

// ⚙️ ดึงอัตราจ่ายรางวัลจาก Sheet "Settings"
// โครงสร้าง Settings Sheet: A=ประเภท B=อัตราจ่าย
// ตัวอย่าง: 2ตัว_บน | 70  , 2ตัว_ล่าง | 70 , 3ตัว_บน | 500 , 3ตัว_โต๊ด | 150
function getPayoutSettings() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_SETTINGS);
    
    // ถ้าไม่มีชีทให้สร้างใหม่พร้อมค่า default
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_SETTINGS);
      sheet.getRange("A1:B1").setValues([["ประเภท", "อัตราจ่าย (ต่อ 1K)"]]);
      const defaults = [
        ["2ตัว_บน", 70],
        ["2ตัว_ล่าง", 70],
        ["3ตัว_บน", 500],
        ["3ตัว_ล่าง", 0],
        ["3ตัว_โต๊ด", 150],
        ["รวม_บน", 70],
        ["รวม_ล่าง", 70]
      ];
      sheet.getRange(2, 1, defaults.length, 2).setValues(defaults);
    }
    
    const values = sheet.getDataRange().getDisplayValues();
    const settings = {};
    for (let i = 1; i < values.length; i++) {
      if (values[i][0]) {
        settings[values[i][0].toString().trim()] = parseFloat(values[i][1]) || 0;
      }
    }
    return settings;
  } catch(e) {
    // ค่า default ถ้าเกิดข้อผิดพลาด
    return { "2ตัว": 70, "3ตัว": 500 };
  }
}

// ⚙️ บันทึกอัตราจ่ายลง Sheet "Settings"
function savePayoutSettings(settings) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) { sheet = ss.insertSheet(SHEET_SETTINGS); }
    
    sheet.clearContents();
    sheet.getRange("A1:B1").setValues([["ประเภท", "อัตราจ่าย (ต่อ 1K)"]]);
    
    const rows = Object.entries(settings).map(([k, v]) => [k, parseFloat(v) || 0]);
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, 2).setValues(rows);
    }
    return { success: true, message: "✅ บันทึกอัตราจ่ายรางวัลเรียบร้อยแล้ว!" };
  } catch(e) {
    return { success: false, message: "❌ บันทึกล้มเหลว: " + e.toString() };
  }
}

// 👥 จัดการพนักงาน: add / edit / delete
function manageStaffData(mode, name, pin) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_CUSTOMER);
    if (!sheet) return { success: false, message: "❌ ไม่พบ Sheet Customer" };

    const data = sheet.getDataRange().getValues();
    const cleanName = name ? name.toString().trim() : "";

    if (mode === "add") {
      // ตรวจซ้ำ
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
          return { success: false, message: "❌ ชื่อพนักงานนี้มีอยู่แล้ว" };
        }
      }
      sheet.appendRow([cleanName, pin.toString().trim()]);
      return { success: true, message: `✅ เพิ่มพนักงาน "${cleanName}" เรียบร้อยแล้ว` };
    }

    if (mode === "edit") {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
          sheet.getRange(i + 1, 2).setValue(pin.toString().trim());
          return { success: true, message: `✅ แก้ไข PIN ของ "${cleanName}" เรียบร้อยแล้ว` };
        }
      }
      return { success: false, message: "❌ ไม่พบพนักงานนี้" };
    }

    if (mode === "delete") {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim().toLowerCase() === cleanName.toLowerCase()) {
          sheet.deleteRow(i + 1);
          return { success: true, message: `✅ ลบพนักงาน "${cleanName}" เรียบร้อยแล้ว` };
        }
      }
      return { success: false, message: "❌ ไม่พบพนักงานนี้" };
    }

    return { success: false, message: "❌ mode ไม่ถูกต้อง" };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// 🏆 บันทึกผลรางวัลลง Sheet "WinHistory"
// โครงสร้าง: A=วันที่ B=เลขรางวัล C=ตำแหน่ง D=จำนวนบิลถูก E=ยอดจ่ายรวม F=บันทึกโดย F=เวลา
function saveWinResult(date, winNum, position, billCount, totalPayout, username) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_WIN_HISTORY);
    if (!sheet) return { success: false, message: "❌ ไม่พบ Sheet WinHistory" };

    // ตรวจสอบว่ามีเลขนี้วันนี้แล้วหรือยัง
    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      if (existing[i][0] && existing[i][0].toString().trim() === date.toString().trim() &&
          existing[i][1] && existing[i][1].toString().trim() === winNum.toString().trim() &&
          existing[i][2] && existing[i][2].toString().trim() === position.toString().trim()) {
        // อัปเดตแทน
        sheet.getRange(i + 1, 4).setValue(parseInt(billCount) || 0);
        sheet.getRange(i + 1, 5).setValue(parseFloat(totalPayout) || 0);
        sheet.getRange(i + 1, 7).setValue(new Date());
        return { success: true, message: `✅ อัปเดตผลรางวัล ${winNum} [${position}] วันที่ ${date} แล้ว` };
      }
    }

    // เพิ่มแถวใหม่
    const now = new Date();
    sheet.appendRow([
      date.toString().trim(),
      winNum.toString().trim(),
      position.toString().trim(),
      parseInt(billCount) || 0,
      parseFloat(totalPayout) || 0,
      username ? username.toString().trim() : "superadmin",
      now
    ]);

    return { success: true, message: `✅ บันทึกผลรางวัล ${winNum} [${position}] วันที่ ${date} เรียบร้อย!` };
  } catch(e) {
    return { success: false, message: "❌ " + e.toString() };
  }
}

// 📊 ดึงสถิติคนถูกหวยแยกช่วงเวลา
function getWinHistory() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_WIN_HISTORY);
    if (!sheet) return { success: false, today:0, yesterday:0, week:0, month:0, year:0, records:[] };

    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const toStr = d => `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
    const todayStr = toStr(now);
    const yest = new Date(now); yest.setDate(yest.getDate()-1);
    const yesterdayStr = toStr(yest);

    let today=0, yesterday=0, week=0, month=0, year=0;
    let records = [];

    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      const rowDateStr = data[i][0].toString().trim();
      const count = parseInt(data[i][3]) || 0;

      // แปลง d/M/yyyy เป็น Date
      const parts = rowDateStr.split('/');
      if (parts.length !== 3) continue;
      const rowDate = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
      const diffDays = Math.floor((now - rowDate) / 86400000);

      if (rowDateStr === todayStr)     today     += count;
      if (rowDateStr === yesterdayStr) yesterday += count;
      if (diffDays <= 6)               week      += count;
      if (rowDate.getMonth() === now.getMonth() && rowDate.getFullYear() === now.getFullYear()) month += count;
      if (rowDate.getFullYear() === now.getFullYear()) year += count;

      records.push({
        date:     rowDateStr,
        winNum:   data[i][1] ? data[i][1].toString().trim() : "",
        position: data[i][2] ? data[i][2].toString().trim() : "",
        count:    count,
        payout:   parseFloat(data[i][4]) || 0
      });
    }

    return { success: true, today, yesterday, week, month, year, records: records.reverse() };
  } catch(e) {
    return { success: false, today:0, yesterday:0, week:0, month:0, year:0, records:[] };
  }
}

// ⏰ บันทึกเวลาปิดขายลง Settings Sheet
function saveTimeLimitsToSheet(lao, thai) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return { success: false, message: "❌ ไม่พบ Sheet Settings" };
    const data = sheet.getDataRange().getValues();
    let laoRow = -1, thaiRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === "close_lao")  laoRow  = i + 1;
      if (data[i][0] === "close_thai") thaiRow = i + 1;
    }
    if (laoRow > 0)  { sheet.getRange(laoRow, 2).setValue(lao); }
    else             { sheet.appendRow(["close_lao", lao]); }
    if (thaiRow > 0) { sheet.getRange(thaiRow, 2).setValue(thai); }
    else             { sheet.appendRow(["close_thai", thai]); }
    return { success: true, message: `✅ บันทึกเวลาแล้ว: ลาว ${lao} / ไทย ${thai}` };
  } catch(e) { return { success: false, message: e.toString() }; }
}

// ⏰ ดึงเวลาปิดขายจาก Settings Sheet
function getTimeLimitsFromSheet() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return { success: true, lao: "20:15", thai: "15:15" };
    const data = sheet.getDataRange().getValues();
    let lao = "20:15", thai = "15:15";
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === "close_lao")  lao  = data[i][1] ? data[i][1].toString().trim() : "20:15";
      if (data[i][0] === "close_thai") thai = data[i][1] ? data[i][1].toString().trim() : "15:15";
    }
    return { success: true, lao, thai };
  } catch(e) { return { success: true, lao: "20:15", thai: "15:15" }; }
}

// 🔐 เปลี่ยนรหัสผ่าน Super Admin
function changeAdminPasswordData(oldPass, newPass) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SUPER_ADMIN);
    if (!sheet) return { success: false, message: "❌ ไม่พบ Sheet Super Admin" };
    const data = sheet.getDataRange().getValues();
    // row 1 = header, row 2 = รหัสผ่าน
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === oldPass.toString().trim()) {
        sheet.getRange(i + 1, 1).setValue(newPass.toString().trim());
        return { success: true, message: "✅ เปลี่ยนรหัสผ่านสำเร็จแล้ว!" };
      }
    }
    return { success: false, message: "❌ รหัสผ่านปัจจุบันไม่ถูกต้อง" };
  } catch(e) { return { success: false, message: e.toString() }; }
}
// ========== 🔐 SINGLE SESSION LOCK ==========
// Sheet "Sessions": A=username B=sessionToken C=timestamp(ms) D=status

function getOrCreateSessionSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_SESSIONS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SESSIONS);
    sheet.getRange("A1:D1").setValues([["username","sessionToken","timestamp","status"]]);
    sheet.getRange(1,1,1,4).setFontWeight("bold").setBackground("#0a84ff").setFontColor("#ffffff");
  }
  return sheet;
}

function checkAndLockSession(ss, username) {
  try {
    const sheet = getOrCreateSessionSheet(ss);
    const data = sheet.getDataRange().getValues();
    const now = new Date().getTime();
    const EXPIRE_MS = 5 * 60 * 1000; // session หมดอายุใน 5 นาทีถ้าไม่มี heartbeat

    // หา row ของ user นี้
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim().toLowerCase() === username.toLowerCase()) {
        const lastSeen = parseInt(data[i][2]) || 0;
        const status = data[i][3] ? data[i][3].toString().trim() : "";
        const elapsed = now - lastSeen;

        if (status === "active" && elapsed < EXPIRE_MS) {
          // มี active session อยู่แล้ว — ห้าม login ซ้ำ
          const minLeft = Math.ceil((EXPIRE_MS - elapsed) / 60000);
          return { allowed: false, message: `บัญชี "${username}" กำลังใช้งานอยู่บนเครื่องอื่น\nรอให้อีกเครื่อง logout ก่อนแล้วลองใหม่` };
        }

        // session เก่าหมดอายุแล้ว — อัปเดตให้ใหม่
        const newToken = Utilities.getUuid();
        sheet.getRange(i + 1, 2).setValue(newToken);
        sheet.getRange(i + 1, 3).setValue(now);
        sheet.getRange(i + 1, 4).setValue("active");
        return { allowed: true, token: newToken };
      }
    }

    // ไม่มี row เลย — สร้างใหม่
    const newToken = Utilities.getUuid();
    sheet.appendRow([username, newToken, now, "active"]);
    return { allowed: true, token: newToken };

  } catch(e) {
    // ถ้า error ให้ผ่านไปก่อน (fail-open) ไม่กวนการ login จริง
    return { allowed: true, token: "fallback-" + new Date().getTime() };
  }
}

function heartbeatSession(username, sessionToken) {
  try {
    if (!username || !sessionToken) return { success: false };
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = getOrCreateSessionSheet(ss);
    const data = sheet.getDataRange().getValues();
    const now = new Date().getTime();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim().toLowerCase() === username.toLowerCase()) {
        const storedToken = data[i][1] ? data[i][1].toString().trim() : "";

        // token ไม่ตรง = มีคนอื่น login แย่ง session ไปแล้ว
        if (storedToken !== sessionToken) {
          return { success: true, forceLogout: true };
        }

        // token ตรง — ต่ออายุ timestamp
        sheet.getRange(i + 1, 3).setValue(now);
        sheet.getRange(i + 1, 4).setValue("active");
        return { success: true, forceLogout: false };
      }
    }
    return { success: true, forceLogout: false };
  } catch(e) {
    return { success: true, forceLogout: false };
  }
}

function unlockSession(username, sessionToken) {
  try {
    if (!username) return { success: false };
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = getOrCreateSessionSheet(ss);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim().toLowerCase() === username.toLowerCase()) {
        const storedToken = data[i][1] ? data[i][1].toString().trim() : "";
        // ปลด session เฉพาะ token ตรงกัน (ป้องกัน user A ปลด session user A คนละเครื่อง)
        if (!sessionToken || storedToken === sessionToken) {
          sheet.getRange(i + 1, 4).setValue("inactive");
        }
        return { success: true };
      }
    }
    return { success: true };
  } catch(e) {
    return { success: false };
  }
}