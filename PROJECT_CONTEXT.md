# 🎯 HUAYPRO 2 — Project Context สำหรับแชทใหม่

## 📋 สรุปโปรเจค
Web App ขายหวยออนไลน์ สร้างด้วย HTML/CSS/JS (Frontend) + Google Apps Script (Backend)
ทำงานเป็น PWA บนมือถือ

---

## 🔗 Google Sheets
- **Spreadsheet ID:** `1QIwNCJ0xLEuS-9qfTkucSbTt29F9pvnzzblu3boo-Qc`
- **Sheet ที่มี:**
  | Sheet | หน้าที่ |
  |---|---|
  | `Base Huay2` | เก็บข้อมูลบิลการขายทั้งหมด |
  | `Customer` | เก็บชื่อพนักงาน A=NAME, B=PIN |
  | `Settings` | อัตราจ่ายรางวัล + เวลาปิดขาย |
  | `WinHistory` | ประวัติคนถูกหวย |
  | `Super Admin` | Username+Password ของ Super Admin |

## 📊 โครงสร้าง Sheet "Base Huay2"
| Column | ข้อมูล |
|---|---|
| A | Bill ID |
| B | วันที่ (d/M/yyyy ค.ศ.) |
| C | เวลา |
| D | ชื่อพนักงาน (NAME) |
| E | ชื่อลูกค้า |
| F | เลข |
| G | ตำแหน่ง (บน/ล่าง/รวม/โต๊ด) |
| H | ราคา |
| I | ประเภท (ลาว/ไทย) |
| J | สถานะ (ปกติ/ยกเลิก) |

---

## 🏗️ โครงสร้างไฟล์
```
/
├── Code.gs       — Google Apps Script Backend
├── index.html    — หน้าหลัก (ทุก page อยู่ในนี้)
├── app.js        — JavaScript ทั้งหมด
├── styles.css    — CSS Dark Theme
├── login.html    — (ถ้าแยกไว้)
└── manifest.json — PWA config
```

---

## 👥 ระบบผู้ใช้
- **พนักงาน (Staff)** — Login ด้วย NAME + PIN 4 หลัก
- **Super Admin** — Login ด้วย Username + Password

---

## 📱 หน้าที่มีในแอพ

### พนักงาน (Staff)
| หน้า | ID | หน้าที่ |
|---|---|---|
| เมนูหลัก | `menuPage` | 4 เมนู |
| บันทึกบิล | `recorderWrapper` | กรอกเลข+เงิน |
| แดชบอร์ด | `dashboardPage` | ยอดขาย+กราฟ |
| ตรวจหวย | `checkWinStaffPage` | ค้นหาคนถูก |
| ประวัติบิล | `billHistoryPage` | บิลย้อนหลัง |

### Super Admin
| หน้า | ID | หน้าที่ |
|---|---|---|
| เมนูหลัก | `superAdminMenuPage` | 5 เมนู |
| พนักงาน | `staffPage` | เพิ่ม/แก้/ลบ |
| ยอดขายพนักงาน | `staffSalesPage` | Sub-menu |
| — ยอดขายทั้งหมด | `totalSalesPage` | สถิติรวม |
| — คนถูกหวย | `winnerStatPage` | สถิติรางวัล |
| — แยกรายพนักงาน | `staffBreakdownPage` | กรองตามวัน |
| ปรับเวลา | `timeLimitPage` | ปิดรับลาว/ไทย |
| ตรวจหวย | `checkWinPage` | Admin version |
| ตั้งค่า | `settingsPage` | Sub-menu |
| — อัตราจ่าย | `payoutSettingPage` | 2ตัว/3ตัว |
| — เปลี่ยนรหัสผ่าน | `changePassPage` | Admin pass |
| — โหมดสี | `colorModePage` | Light/Dark/Auto |

---

## ⚙️ Features ที่ทำเสร็จแล้ว
- ✅ Login PIN 4 ช่อง + Switch Admin/Staff
- ✅ นาฬิกา Server Time (ป้องกันโกงเวลา)
- ✅ เช็คเวลาปิดขายก่อนบันทึก
- ✅ เตือน 15 นาทีก่อนหมดเวลา
- ✅ Session timeout 30 นาที
- ✅ ล็อกหลังกรอก PIN ผิด 5 ครั้ง
- ✅ Bottom Bar ทุกหน้า
- ✅ บันทึกบิลหวยลาว/ไทย
- ✅ Popup เลือก บน/ล่าง/บน+ล่าง (หวยไทย 2 ตัว)
- ✅ ใบบิน 5 คอลัมน์ กดค้าง 1 วินาทีบันทึกรูป
- ✅ ตรวจหวย + ใบบินรางวัล highlight เลขถูก
- ✅ ปุ่มบันทึกผลรางวัลลง WinHistory
- ✅ กราฟยอดขาย 7 วัน (Canvas)
- ✅ ยอดขายแยกรายพนักงาน + กรองตามวัน
- ✅ จัดการพนักงาน (เพิ่ม/แก้ PIN/ลบ)
- ✅ อัตราจ่าย 2ตัว=70x, 3ตัว=500x (ปรับได้)
- ✅ Color Mode Light/Dark/Auto
- ✅ เวลาปิดขายบันทึกลง Sheet

---

## 🚧 สิ่งที่ยังค้างหรืออาจต้องปรับ
- ⬜ Export รายงานเป็น Excel/PDF
- ⬜ ยกเลิกบิล (มี UI แต่ยังไม่ได้ทดสอบครบ)
- ⬜ สีธีมใหม่ (เจ้าของบอกว่าจะทำ)
- ⬜ ทดสอบ Color Mode Light ให้ครบทุกหน้า

---

## 🔧 การ Deploy
1. เอา `Code.gs` วางใน Google Apps Script
2. Deploy เป็น Web App (Execute as: Me, Access: Anyone)
3. Copy URL ไปใส่ใน `app.js` ตัวแปร `BACKEND_API_URL`
4. รัน `setupSettings()` ครั้งแรกเพื่อสร้าง Sheet Settings

---

## 💡 สิ่งสำคัญที่ต้องรู้
- วันที่ใน Sheet เก็บเป็น **ค.ศ.** (2026) ไม่ใช่ พ.ศ.
- Username ที่ใช้ใน Sheet คือ **NAME** (เช่น JEN) ไม่ใช่ ID (001)
- หวยลาว ไม่มีบน/ล่าง — หวยไทย 2 ตัว เท่านั้นที่มีบน/ล่าง
- อัตราจ่าย key ใน Settings: `2ตัว` และ `3ตัว`
