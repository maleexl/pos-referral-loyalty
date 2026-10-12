<!--
FILE: docs/DEMO-SCRIPT.md
PURPOSE: Walkthrough script for demonstrating the POS Referral & Loyalty
         system. Each step lists the action, what the audience sees, and a
         suggested line to say. Thai prose + English technical terms.
READER: Whoever runs the demo (interview, stakeholder review, onboarding).
LAST UPDATED: 2026-10-12 @ commit 993cdf75 (Sprint 3 close).
SOURCE OF TRUTH: tests/e2e/customer-flow.spec.ts (runnable happy path),
                 docs/API-CONTRACT.md, docs/SPEC.md.
-->

# DEMO-SCRIPT — POS Referral & Loyalty

**Script นี้เป็น guideline — อย่าอ่าน verbatim**  
ปรับคำพูดให้เป็นธรรมชาติของตัวเอง โดยเฉพาะ "พูด:" ให้ paraphrase
เป้าหมายคือให้ผู้ชมเข้าใจ flow ไม่ใช่ท่อง script

แต่ละ step มี 3 ส่วน:
- **ทำ:** action บนหน้าจอ
- **เห็น:** สิ่งที่ผู้ชมควรสังเกต
- **พูด:** ประโยคสั้นสำหรับผู้ชม — technical detail เก็บไว้ Q&A §7

**Sample data ที่จะใช้ตลอด demo** (reproducible — ใช้ซ้ำได้ทุกครั้ง):

    email:  demo-alice@example.com      referee: demo-bob@example.com
    phone:  0812345678                  phone:   0898765432
    name:   Alice Demo                  name:    Bob Referee

หมายเหตุ: seed ของ backend สร้างแค่ settings + 1 admin staff — **ไม่มี customer
seed** ดังนั้น demo data ทั้งหมดเกิดจาก UI ในขั้น §1 เอง

---

## §0 Prerequisites

### §0.1 Before you start (รันครั้งเดียว)

Terminal 1 — Postgres + migration + seed:

    cd ~/pos-referral-loyalty
    docker compose up -d                    # postgres:16-alpine ที่ :5440
    cd backend
    npx prisma migrate deploy
    npx prisma db seed                      # 5 settings + 1 admin staff

Terminal 2 — Backend (Fastify :3000):

    cd ~/pos-referral-loyalty/backend
    npm run dev                             # tsx watch src/server.ts
    curl http://localhost:3000/health       # sanity: {"status":"ok"}

Terminal 3 — Frontend (Vite :5173):

    cd ~/pos-referral-loyalty/frontend
    cp .env.example .env                    # ต้องมี VITE_API_URL=http://localhost:3000
    npm run dev

**ทำไมต้องมี CORS_ORIGIN:** backend register `@fastify/cors` เฉพาะเมื่อ env ตั้ง
— `backend/.env.example` default `http://localhost:5173` อยู่แล้ว ถ้าแก้ env
ห้ามลบ `CORS_ORIGIN` ไม่งั้น browser จะโดน preflight block

### §0.2 During demo (สมมติว่ารันอยู่แล้ว)

- **Browser tab 1:** http://localhost:5173/customer
- **Browser tab 2:** http://localhost:5173/staff
- **Terminal 4 (optional):** เปิดไว้สำหรับ mock POS curl ใน §3

**ผู้ชมควรเห็นตอนเปิด tab:** redirect จาก `/` → `/customer` อัตโนมัติ
(root route ใน `App.tsx` redirect ไป customer — audience หลักคือลูกค้า)

---

## §1 Customer page — register → referral → invite

**หน้า:** http://localhost:5173/customer

**ทำ 1.0 — เปิดหน้า (before clicking anything)**
- **เห็น:** register form + nav bar "Customer · Staff · Admin"
- **พูด:** "หน้านี้ให้ลูกค้าสร้าง referral code แชร์ให้เพื่อน — flow สั้นที่สุดในระบบ ลูกค้าใหม่ลงทะเบียน, ได้รหัส, แล้วชวนเพื่อนได้เลย"

**ทำ 1.1 — กรอก email / phone / name → กด Register**

ใช้ sample data: `demo-alice@example.com` / `0812345678` / `Alice Demo`

- **เห็น:** register form หาย, referral card ปรากฏขึ้นแทนทันที
- **พูด:** "POST /api/customers — backend สร้าง customer row, generate referral code (prefix จากชื่อ + 4 ตัวสุ่ม), return 201 พร้อมรหัส"

**ทำ 1.2 — ชี้ที่ `referral-code`**

- **เห็น:** code ขึ้นต้นด้วย `ALICE` (prefix จากชื่อ) + อักขระสุ่ม (เช่น `ALICE8X2K`)
- **พูด:** "รหัสนี้คือ handle ที่ลูกค้าแชร์ให้เพื่อน เป็น human-readable ไม่ใช่ UUID — staff พิมพ์ตามได้"

**ทำ 1.3 — ชี้ที่ `points-balance`**

- **เห็น:** `0`
- **พูด:** "คะแนนเริ่มที่ 0 — balance ไม่ได้เก็บเป็น column แต่คำนวณจาก SUM ของ reward ledger ตอน read"

**ทำ 1.4 — ชี้ที่ `referral-list` (ว่าง)**

- **เห็น:** empty state — list ไม่มี `<li>` ใด ๆ
- **พูด:** "ยังไม่มี referral — list นี้มาจาก GET /api/customers/:code/referrals ที่เพิ่มใน Sprint 3"

**ทำ 1.5 — กรอก referee info → กด Invite**

ใช้ `demo-bob@example.com` / `0898765432` / `Bob Referee`

- **เห็น:** `referee-success` banner ปรากฏ
- **พูด:** "POST /api/referrals — atomic transaction: สร้าง referee customer + referral row status=PENDING ในหนึ่ง transaction expiresAt = now + 30 days (ค่าจาก settings table) ถ้า fail กลางทาง rollback ทั้งก้อน"

**ทำ 1.6 — รีเฟรชหน้า (F5)**

- **เห็น:** referral code ยังอยู่ — ไม่ต้องกรอกใหม่
- **พูด:** "referralCode persist ใน localStorage ถ้า code ถูกลบฝั่ง server (404) หน้า reset กลับไป register form เอง self-healing"

**ผู้ชมควรเห็น:** หน้า Customer สมบูรณ์ใน ~60 วินาที

---

## §2 Staff page — key → lookup → redeem → confirm

**หน้า:** http://localhost:5173/staff

**ทำ 2.0 — คลิก Staff ใน nav**

- **เห็น:** staff-key prompt (form 1 input + submit)
- **พูด:** "Staff endpoints ใช้ API key ไม่ใช่ JWT — key มาจาก env ฝั่ง backend ผูกกับ browser นี้ผ่าน localStorage หลัง validate ครั้งแรก"

**ทำ 2.1 — กรอก staff key → กด Submit**

ค่า default: `change_me_staff` (จาก `backend/.env`)

- **เห็น:** prompt หายไป ปรากฏ customer lookup form
- **พูด:** "key validate ผ่าน X-Staff-Key header บน endpoint จริง — ถ้า 401, clear storage แล้วกลับมา prompt เดิม"

**ทำ 2.2 — กรอก referral code ของ Alice (§1) → กด Lookup**

- **เห็น:** customer card + redemption form + confirm form ปรากฏ
- **พูด:** "staff ค้นหาลูกค้าด้วย referral code ระบบ pre-load customer object ให้ทั้ง redemption form และ confirm form ข้างล่าง"

**ทำ 2.3 — กรอก points (เช่น 50) → กด Redeem**

- **เห็น:** `redemptionCode` ปรากฏ (8 ตัว charset ที่ตัด 0/O/1/I ออก), `pointsRemaining`
- **พูด:** "POST /staff/redeem — ตรวจ balance ก่อน (BR-7) แล้วสร้าง signed ledger entry -50 points type=REDEMPTION code มีอายุ 7 วัน (จาก settings)"

**ทำ 2.4 — Copy code → วางใน confirm form → กด Confirm**

- **เห็น:** success message status REDEEMED
- **พูด:** "POST /staff/redeem/confirm — UPDATE WHERE status=ISSUED แบบ optimistic lock ป้องกัน double confirm ถ้า race ตัวที่แพ้ได้ 409"

**ทำ 2.5 — ลอง Redeem เกิน balance (edge case)**

ลูกค้าเดิม balance 0 → ลอง redeem 100

- **เห็น:** error banner "Insufficient points"
- **พูด:** "BR-7 — 400 INSUFFICIENT_POINTS ไม่ใช่ 500 เพราะเป็น client error"

**หมายเหตุ:** ถ้า interviewer อยากดู happy path เท่านั้น → ข้าม 2.5 ได้

**ผู้ชมควรเห็น:** หน้า Staff ทำงานครบ loop issue → confirm ใน ~90 วินาที

---

(§3 Admin + §4 API Tour + §5 5-min flow + §6 Known limitations + §7 Q&A — chunk ถัดไป)

## §3 Admin page — via curl (UI ยัง placeholder)

**หมายเหตุ:** Admin page ใน Sprint 3 ยังเป็น placeholder — หน้าจอไม่แสดง
อะไร เพื่อไม่ให้ demo สะดุด เราจะสาธิต admin layer ผ่าน curl โดยตรง
(ทุก endpoint ตรงกับ API-CONTRACT §F4)

**ค่าเริ่มต้น:** `ADMIN_API_KEY=change_me_admin` (จาก `backend/.env`)

**ทำ 3.0 — แสดง admin key ผ่าน PowerShell/WSL**

    export ADMIN_KEY=change_me_admin

- **พูด:** "Admin layer ใช้ API key แยกจาก staff — คนละ scope คนละ header enforce ที่ plugin scope ของ Fastify"

**ทำ 3.1 — GET /admin/referrals (list)**

    curl -s -H "X-Admin-Key: $ADMIN_KEY" \
      "http://localhost:3000/admin/referrals?limit=5" | python3 -m json.tool

- **เห็น:** `total` + `page` + `limit` + `items[]` — แต่ละ item มี referrer + referee + status
- **พูด:** "Admin เห็น referral ทั้งระบบ พร้อม filter by status และ pagination — เราเห็น referral ของ Alice ที่เพิ่งสร้างไปใน §1"

**ทำ 3.2 — GET /admin/redemptions**

    curl -s -H "X-Admin-Key: $ADMIN_KEY" \
      "http://localhost:3000/admin/redemptions?limit=5" | python3 -m json.tool

- **เห็น:** redemption row ที่เพิ่ง confirm ใน §2 (status=REDEEMED, points ติดลบ)
- **พูด:** "Ledger กลับมาเป็น signed points — earn เป็นบวก, redeem เป็นลบ balance คือผลรวม"

**ทำ 3.3 — GET /admin/settings**

    curl -s -H "X-Admin-Key: $ADMIN_KEY" \
      http://localhost:3000/admin/settings | python3 -m json.tool

- **เห็น:** 5 keys (points_per_referral, referral_expiry_days, redemption_expiry_days, reward_code_length, points_to_thb_rate)
- **พูด:** "ทุก business value อยู่ใน DB — operator แก้ได้โดยไม่ต้อง redeploy"

**ทำ 3.4 — PATCH /admin/settings (เปลี่ยน points_per_referral)**

    curl -s -X PATCH -H "X-Admin-Key: $ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{"points_per_referral":"150"}' \
      http://localhost:3000/admin/settings | python3 -m json.tool

- **เห็น:** response มี `points_per_referral: "150"` (และ keys อื่นครบ)
- **พูด:** "settings loader invalidate cache หลัง commit — request ถัดไปเห็นค่าใหม่ทันที ไม่ต้องรอ TTL"

**ทำ 3.5 — ยืนยันค่าถูกใช้จริง: GET /admin/settings อีกครั้ง**

    curl -s -H "X-Admin-Key: $ADMIN_KEY" \
      http://localhost:3000/admin/settings | python3 -m json.tool | grep points_per_referral

- **เห็น:** `"points_per_referral": "150"`
- **พูด:** "confirm ว่า cache invalidate ทำงานจริง — ค่าใหม่ propagate ทันที"

**ผู้ชมควรเห็น:** admin layer ทำงานครบทั้ง 4 endpoints ใน ~60 วินาที

---

## §4 API Tour — curl cheat sheet

**หมายเหตุ:** ทุก endpoint ตรงกับ `docs/API-CONTRACT.md` — ใช้เป็น reference
เร็ว ๆ สำหรับ interviewer ที่อยากเห็นว่า API ทำงานยังไง

**Public (ไม่ต้องมี key):**

    # Register customer
    curl -X POST http://localhost:3000/api/customers \
      -H "Content-Type: application/json" \
      -d '{"email":"x@example.com","phone":"0811111111","name":"X"}'

    # Lookup customer by code
    curl http://localhost:3000/api/customers/ALICE8X2K

    # Create referral
    curl -X POST http://localhost:3000/api/referrals \
      -H "Content-Type: application/json" \
      -d '{"referrerCode":"ALICE8X2K","refereeEmail":"y@example.com","refereePhone":"0822222222","refereeName":"Y"}'

    # List a customer's referrals
    curl http://localhost:3000/api/customers/ALICE8X2K/referrals

    # Customer's rewards + balance
    curl http://localhost:3000/api/customers/ALICE8X2K/rewards

**Mock POS (ไม่ต้องมี key):**

    # Record a visit — completes the referee's PENDING referral
    curl -X POST http://localhost:3000/internal/mock-pos/visits \
      -H "Content-Type: application/json" \
      -d '{"customerEmail":"y@example.com","amount":500,"note":"first visit"}'

**Staff (ต้อง X-Staff-Key):**

    curl -X POST http://localhost:3000/staff/redeem \
      -H "X-Staff-Key: change_me_staff" \
      -H "Content-Type: application/json" \
      -d '{"customerCode":"ALICE8X2K","points":50}'

    curl -X POST http://localhost:3000/staff/redeem/confirm \
      -H "X-Staff-Key: change_me_staff" \
      -H "Content-Type: application/json" \
      -d '{"redemptionCode":"R8K2MX9Q"}'

**Admin (ต้อง X-Admin-Key):** ดู §3

**Error envelope:** ทุก endpoint คืน `{"error": "...", "code": "...", "details": {...}}`
เมื่อ fail — code ตรงกับตาราง Standard Errors ใน API-CONTRACT

---

## §5 Complete 5-minute flow

รันตามลำดับนี้เพื่อ demo end-to-end ในเวลาที่จำกัด:

1. **§0.2** — เปิด 2 tabs: `/customer` + `/staff` (10 วิ)
2. **§1.1** — Register Alice (15 วิ)
3. **§1.5** — Invite Bob (15 วิ)
4. **§4 Mock POS curl** — Bob completes visit → Alice ได้ 100 points (20 วิ)
5. **§1.6** — Refresh customer page → เห็น referral list มี Bob (COMPLETED) + pointsBalance=100 (15 วิ)
6. **§2.2** — Staff lookup Alice (10 วิ)
7. **§2.3** — Redeem 50 points (15 วิ)
8. **§2.4** — Confirm redemption (10 วิ)
9. **§3.1** — Admin list referrals (10 วิ)
10. **§3.3** — Admin settings (10 วิ)

**รวม ~2:20** — เผื่อ 2:40 สำหรับ Q&A

**Highlight ตอนจบ:** "เราสร้างลูกค้า, ชวนเพื่อน, complete referral ผ่าน POS, redeem points, confirm redemption, และดู admin view — ทั้งหมดใน unified system ที่มี transaction safety + idempotency + DB-backed config"

---

## §6 Known limitations

Things ที่ MVP จงใจไม่ทำ — ตรงกับ SPEC §7 + DECISIONS:

- **ไม่มี real POS integration** — `/internal/mock-pos/*` เป็น stand-in
  production จะเป็น signed webhook หรือ mTLS
- **ไม่มี JWT / end-user login** — callers เป็น services ใช้ static API key
  (DECISIONS #5) ถึงเวลาที่มี first-party web login ค่อย revisit
- **ไม่มี email/SMS notification** — referee-success เป็น UI ack เท่านั้น
  ไม่มีของจริงส่ง
- **ไม่มี multi-branch / multi-tenant** — ทุกอย่าง single-tenant
- **ไม่มี QR code scanning** — manual code entry เท่านั้น
- **Concurrent redemption issue (multi-terminal)** — balance read ไม่ได้ห่อ
  transaction (ดู `issueRedemption.ts` comment) MVP สมมติ single-staff
  Multi-terminal จะต้อง SERIALIZABLE หรือ advisory lock
- **Admin UI ยังเป็น placeholder** — endpoints ทำงาน แต่หน้าเว็บว่าง
  Sprint 4 จะทำให้ครบ
- **Staff table ไม่ได้ใช้ใน auth** — env-var keys เท่านั้น staff table
  forward-looking สำหรับอนาคต

---

## §7 Q&A prep

คำถามที่ interviewer/ผู้ชมน่าจะถาม — คำตอบเต็มอยู่ใน `docs/QA-CHEATSHEET.md`
ด้านล่างคือ TL;DR สำหรับ demo:

1. **ทำไม monorepo?** — shared contract, atomic commits, CI เดียว
   → CHEATSHEET Q1
2. **ทำไม Fastify ไม่ใช่ Express?** — schema validation, plugin scope,
   performance → CHEATSHEET Q2
3. **ทำไม Prisma ไม่ใช่ TypeORM?** — schema.prisma = single source of truth
   → CHEATSHEET Q3
4. **ทำไม settings table ไม่ใช่ env vars?** — tunable without redeploy,
   single source across instances → CHEATSHEET Q4
5. **ทำไม API key ไม่ใช่ JWT?** — callers เป็น services ไม่ใช่ users
   → CHEATSHEET Q5
6. **Referral completion atomic ยังไง?** — 2-phase: visit standalone +
   completion in `$transaction` → CHEATSHEET Q6 + CODE-WALKTHROUGH §1.2
7. **Idempotency ทำงานยังไง?** — optimistic lock + UNIQUE(referralId,type)
   → CHEATSHEET Q7
8. **Business config มาจากไหน?** — settings table ผ่าน typed getters
   → CHEATSHEET Q8
9. **เทสต์ DB ยังไง?** — real Postgres + `app.inject()`, fileParallelism:false
   → CHEATSHEET Q9
10. **CI รันอะไรบ้าง?** — 3 jobs: Backend / Frontend / E2E (Playwright)
    → CHEATSHEET Q10

**คำถามที่ลึกขึ้น:** interviewer อาจเจาะ transaction isolation, race
condition, หรือ migration strategy — ตอบได้จาก CODE-WALKTHROUGH §1.2
และ §1.3

---

## Footer

Maintained by the project maintainer. ถ้า flow ที่ demo เปลี่ยน
(เช่น admin UI เสร็จ) ให้อัปเดต §3 จาก curl → UI walkthrough
และ bump LAST UPDATED
