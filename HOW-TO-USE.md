# How to Run, Test, and Call API Endpoints (`HOW-TO-USE.md`)

This guide explains how to set up, run, seed demo data, test, and invoke all endpoints in the Mini Wallet Service.

---

## 1. Quick Start

Run these commands inside the `starter/` directory:

```bash
cd starter

# 1. Environment configuration
cp .env.example .env

# 2. Start PostgreSQL container (port 5439)
npm run db:up

# 3. Run database migrations
npm run db:migrate

# 4. (Optional) Seed demo members & wallets
npm run db:seed

# 5. Run automated test suite (all 25 concurrency & business tests)
npm test

# 6. Start the development server (runs on http://localhost:3000)
npm run dev
```

---

## 2. Seeded Sample Data

Running `npm run db:seed` pre-populates the database with two realistic accounts I configured:

| Member Username | Member ID (`UUID`) | Wallet ID (`UUID`) | Balance | Turnover Status | Intended Test Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`demo_alice`** | `11111111-1111-1111-1111-111111111111` | `22222222-2222-2222-2222-222222222222` | `$150.00` | **Locked** (Req: $200, Accrued: $50, Outstanding: $150) | Test withdrawal blocked with `422` & test wagers |
| **`demo_bob`** | `33333333-3333-3333-3333-333333333333` | `44444444-4444-4444-4444-444444444444` | `$300.00` | **Satisfied** (Req: $100, Accrued: $100, Outstanding: $0) | Test withdrawal succeeds immediately (`201`) |

*(To reset or wipe the seed data at any time: `npm run db:seed:undo`)*

---

## 3. API Reference & cURL Examples

All amounts are sent as decimal strings (e.g. `"100.50"`).

### 3.1 Create a Member
Creates a member and an associated zero-balance wallet.
```bash
curl -X POST http://localhost:3000/members \
  -H "Content-Type: application/json" \
  -d '{"username": "player101"}'
```
**Response (201 Created):**
```json
{
  "member": { "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "username": "player101" },
  "wallet": { "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "balance": "0.000000000000000000" }
}
```

---

### 3.2 Get Wallet Balance & Info
Inspects a member's current wallet balance.
```bash
curl -X GET http://localhost:3000/members/11111111-1111-1111-1111-111111111111/wallet
```
**Response (200 OK):**
```json
{
  "id": "22222222-2222-2222-2222-222222222222",
  "memberId": "11111111-1111-1111-1111-111111111111",
  "balance": "150.000000000000000000"
}
```

---

### 3.3 Create a Deposit (`POST /deposits`)
Creates a funding transaction in `Pending` state and generates an opaque `pspRef`. **No money moves yet**.
- `turnoverMultiplier`: integer $\ge 0$ (default: `1`).
```bash
curl -X POST http://localhost:3000/deposits \
  -H "Content-Type: application/json" \
  -d '{
    "memberId": "11111111-1111-1111-1111-111111111111",
    "amount": "100.00",
    "turnoverMultiplier": 1
  }'
```
**Response (201 Created):**
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "pspRef": "psp_dep_e6e22f87-a2f0-4a87-8321-df6e80b27be3",
  "status": "pending",
  "amount": "100.000000000000000000",
  "turnoverMultiplier": 1
}
```

---

### 3.4 Handle PSP Callback Webhook (`POST /psp/callbacks`)
Simulates the webhook from the payment service provider when payment completes or fails.
- **Idempotent**: Calling with the same `pspRef` multiple times or concurrently credits the wallet **exactly once**.
- Writes an append-only entry to `wallet_txs`.
```bash
curl -X POST http://localhost:3000/psp/callbacks \
  -H "Content-Type: application/json" \
  -d '{
    "pspRef": "psp_dep_e6e22f87-a2f0-4a87-8321-df6e80b27be3",
    "status": "completed",
    "amount": "100.00"
  }'
```
**Response (200 OK):**
```json
{
  "idempotent": false,
  "fundingTxId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "completed"
}
```
*(Repeating the same call returns `{"idempotent": true, ...}` and does not credit again).*

---

### 3.5 Record a Wager (`POST /wallets/:walletId/wagers`)
Debits the wallet balance, writes a ledger entry, and accrues turnover.
- **Concurrent Safe**: Uses pessimistic row locking (`SELECT ... FOR UPDATE`); cannot overdraw wallet.
```bash
curl -X POST http://localhost:3000/wallets/22222222-2222-2222-2222-222222222222/wagers \
  -H "Content-Type: application/json" \
  -d '{"amount": "50.00"}'
```
**Response (201 Created):**
```json
{
  "transactionId": "d3b07384-d113-40aa-b88a-2c6c3dfa6499",
  "walletId": "22222222-2222-2222-2222-222222222222",
  "amount": "50.000000000000000000",
  "balance": "200.000000000000000000",
  "turnoverAccrued": "100.000000000000000000"
}
```

---

### 3.6 Withdraw with Turnover Lock (`POST /withdrawals`)
Debits wallet balance and creates a `Pending` withdrawal funding transaction.
- **Anti-Abuse Rule**: Only permitted when `accrued turnover >= required turnover`.

#### Example A: Blocked by Turnover Lock (e.g. Alice)
```bash
curl -X POST http://localhost:3000/withdrawals \
  -H "Content-Type: application/json" \
  -d '{
    "memberId": "11111111-1111-1111-1111-111111111111",
    "amount": "50.00"
  }'
```
**Response (422 Unprocessable Entity):**
```json
{
  "error": "Turnover requirement not met",
  "requiredTurnover": "300.000000000000000000",
  "accruedTurnover": "100.000000000000000000",
  "outstandingTurnover": "200.000000000000000000"
}
```

#### Example B: Successful Withdrawal (e.g. Bob, whose turnover is met)
```bash
curl -X POST http://localhost:3000/withdrawals \
  -H "Content-Type: application/json" \
  -d '{
    "memberId": "33333333-3333-3333-3333-333333333333",
    "amount": "50.00"
  }'
```
**Response (201 Created):**
```json
{
  "id": "c1f19d08-a1e9-4e78-8314-871783cf6204",
  "memberId": "33333333-3333-3333-3333-333333333333",
  "walletId": "44444444-4444-4444-4444-444444444444",
  "amount": "50.000000000000000000",
  "status": "pending",
  "balance": "250.000000000000000000"
}
```

---

## 4. End-to-End Test Suite

Run the full automated test suite containing 25 tests across 6 suites:

```bash
npm test
```

### What is tested:
1. `members.test.ts`: Member and zero-balance wallet creation.
2. `deposits.test.ts`: Pending deposit creation, `pspRef` generation, input validation.
3. `pspCallbacks.test.ts`:
   - Exact-once crediting on completed callback.
   - Sequential duplicate retry handling (idempotency).
   - **Concurrent duplicate callbacks** (`Promise.all` with identical `pspRef`).
   - Amount mismatch rejection (`422`).
   - Invalid state transition rejection (`409 Conflict`).
4. `wagers.test.ts`:
   - Balance debit and turnover accrual.
   - Insufficient balance rejection (`400`).
   - **Concurrent wagers race condition** (five simultaneous requests against insufficient balance proving wallet never overdraws).
5. `withdrawals.test.ts`:
   - Turnover lock blocking (`422`) with outstanding calculation.
   - Turnover lock unblocking after sufficient wagering.
   - Concurrent withdrawal race condition.
6. `ledger.test.ts`:
   - Mathematical proof of **ledger balance reconstructibility**: $\sum \text{ledger deltas} \equiv \text{wallet.balance}$.
   - Audit chain continuity ($\text{balanceBefore}_i = \text{balanceAfter}_{i-1}$).

