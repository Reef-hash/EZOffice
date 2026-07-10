# ZKTeco Device Sync Setup Guide

## Device Configuration (K40 Pro / V1000)

1. Pada device ZKTeco, set IP static:
   - Menu > Communication > Network
   - IP Address: `192.168.0.11` (contoh)
   - Subnet Mask: `255.255.255.0`
   - Gateway: `192.168.0.1`

2. Sambungkan LAN cable ke router yang sama dengan PC.

3. Confirm PC boleh ping device. Device mungkin **tak reply ping** (block ICMP) — itu normal. Guna `Test-NetConnection` PowerShell:

   ```powershell
   Test-NetConnection 192.168.0.11 -Port 4370
   ```

## EZOffice Setup

### 1. Employee → Device User ID Mapping

Setiap employee yang enrolled di device ZKTeco mesti ada **Device User ID** dalam EZOffice.

Device ZKTeco guna internal User ID (nombor kecil: 1, 2, 3...) — biasanya nombor yang tertera dekat device masa enroll fingerprint.

- Buka **Employees** → klik employee
- Isi **Device User ID (ZKTeco)** dengan nombor yang sama dengan device enrollment ID

### 2. Device Settings

- Buka **Attendance** → **Device Settings** tab
- Isi **Device IP Address**: `192.168.0.11`
- Port: `4370` (default ZKTeco)
- Klik **Save Settings**

### 3. Sync Now

- Klik **Sync Now**
- System akan tarik semua log attendance dari device dan masukkan ke database
- Log akan di-assign IN/OUT secara berselang-seli ikut turutan masa (punch 1 = IN, punch 2 = OUT, dst.)

### 4. View Logs

- Tukar **Logs** tab
- Set date filter ke range yang sesuai (device logs mungkin dari hari sebelumnya)
- Log dengan `source = device` akan muncul

## Troubleshooting

| Isu | Punca | Fix |
|---|---|---|
| Sync 0 inserted | Employee ID tak mapping | Set device_user_id dekat employee |
| All logs skipped "no prior log" | Device type field tak support IN/OUT | Fix dah buat — auto alternating |
| Log tak nampak di list | Date filter terlalu sempit | Tukar date range |
| "General failure" ping | VPN adapter ganggu | Disable ProtonVPN adapter |
| "Request timed out" ping | Device block ICMP | Normal — guna port 4370 test |
| Port 4370 tak open | Device IP setting salah | Confirm IP/subnet/gateway dekat device |

## Tech Notes

- Library: `zkteco-js` v1.7.2
- Protocol: ZKTeco TCP (port 4370)
- `getAttendances()` return `{ data: records }` — perlu extract `.data`
- Record fields: `user_id` (string), `record_time` (Date.toString), `type` (number)
- IN/OUT ditentukan oleh position (alternating), bukan dari `type` field device
