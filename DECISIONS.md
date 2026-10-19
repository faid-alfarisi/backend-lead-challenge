# Architecture Decisions & Trade-Offs (`DECISIONS.md`)

This document outlines the architectural decisions, concurrency controls, data modeling invariants, and operational trade-offs I implemented in this service.

---

## 1. Concurrency & Locking Strategy

### 1.1 The Problem
In a high-throughput, real-money transactional system:
- **Hostile Webhook Delivery**: Payment Service Providers (PSPs) frequently retry webhooks, deliver them out-of-order, or dispatch identical callbacks concurrently across multiple in-flight HTTP connections.
- **Race Conditions on Balance Mutation**: Concurrent wagers or withdrawals must never overdraw a wallet or bypass turnover lock constraints.

### 1.2 Pessimistic Row Locking (`SELECT ... FOR UPDATE`)
I chose database-level pessimistic row locks (`t.LOCK.UPDATE` in Sequelize / `SELECT ... FOR UPDATE` in PostgreSQL) inside single atomic transactions:
1. **Funding Transactions (`funding_transactions`)**:
   - When a callback arrives at `POST /psp/callbacks`, I immediately lock the specific funding transaction row by `pspRef`.
   - If two identical callbacks arrive concurrently, Request 1 acquires the lock and transitions the status from `pending` to `completed`.
   - Request 2 waits on the lock; once acquired, it reads the committed state (`status = 'completed'`). Recognizing an identical retry, it returns `200 OK` with `{ idempotent: true }` without touching the wallet or ledger.
2. **Wallet Balance & Turnover (`wallets`)**:
   - For all balance mutations (deposits, wagers, withdrawals), I lock the target `wallet` row `FOR UPDATE`.
   - This serializes concurrent wagers: if five \$20 wagers arrive simultaneously against a \$50 balance, PostgreSQL queues them deterministically. Exactly two succeed, three fail with `400 Insufficient balance`, and the balance never drops below zero.

### 1.3 Why Pessimistic Locking over Optimistic Locking?
- **Optimistic Locking (`version` column)** works well for read-heavy systems with rare collisions. In high-frequency wagering or burst transactions, optimistic concurrency causes frequent serialization aborts, forced rollbacks, and retry storms on the client.
- **Pessimistic Row Locking** relies on PostgreSQL's row-level lock manager, ordering in-flight operations deterministically with sub-millisecond execution times.

### 1.4 Deadlock Prevention
To prevent cyclic deadlocks, transactions always acquire locks in a strict hierarchical order:
1. `funding_transactions` (if applicable)
2. `wallets`
3. Append to `wallet_txs` (insert-only, no row lock required)

---

## 2. Financial Modeling & Append-Only Ledger

### 2.1 Money Precision Invariant
- Floating-point arithmetic (`number` in JavaScript) introduces IEEE 754 precision errors that cannot be tolerated in financial systems.
- **Invariant**: Money is stored as `DECIMAL(36, 18)` in PostgreSQL, transmitted as strings across JSON/API boundaries, and processed exclusively using `bignumber.js` (`BigNumber.ROUND_DOWN`).

### 2.2 Ledger Design (`wallet_txs`)
I treat the wallet balance as a cached summary that must always be provable by an underlying audit trail:
- Every balance mutation generates an immutable, append-only row in `wallet_txs`.
- Each ledger row records:
  - `wallet_id` & optional `funding_tx_id`
  - `type`: `'deposit' | 'wager' | 'withdrawal'`
  - `amount`: decimal string
  - `balance_before`: balance before mutation
  - `balance_after`: balance after mutation
- **Reconstructibility**: The wallet balance is 100% reconstructible at any point by summing all credit and debit entries ($\text{balance} = \sum \Delta \text{amounts}$).
- I verified this property mathematically in the test suite ([`test/ledger.test.ts`](starter/test/ledger.test.ts)).

### 2.3 Turnover Modeling
- Anti-abuse turnover rules dictate:
  $$\text{Required Turnover} = \sum (\text{deposit amount} \times \text{turnoverMultiplier})$$
  $$\text{Accrued Turnover} = \sum (\text{wager amount})$$
- I store `turnover_required` and `turnover_accrued` directly on the `wallets` table.
- **Rationale**: Since every wager or withdrawal already requires locking the wallet row to debit balance, keeping turnover on `wallets` enables atomic turnover evaluation without cross-table lock contention or secondary table joins.

---

## 3. Hostile Infrastructure & PSP Callback Handling

### 3.1 State Machine
The funding transaction enforces an explicit state transition machine:
$$\text{Pending} \longrightarrow \text{Completed} \quad | \quad \text{Failed}$$
- **Duplicate identical callback**: Handled idempotently (`200 OK`).
- **Conflicting status transition** (e.g. attempting to fail an already `completed` transaction): Rejected with `409 Conflict`.
- **Unknown reference**: Rejected with `404 Not Found`.

### 3.2 Amount Mismatch Policy
- **Policy**: If the amount reported in `POST /psp/callbacks` does not match the original deposit request amount, the callback is rejected with `422 Unprocessable Entity`, and **no wallet balance is credited**.
- **Rationale**: In real-money regulated environments, automatic reconciliation of unexpected amounts (whether higher or lower) is a major vector for fraud, money laundering, or currency conversion exploits. Any discrepancy must halt money movement and be routed for manual compliance review.

---

## 4. What I Would Do Next With More Time

1. **Distributed Locks (Redis / Redlock)**:
   - For horizontally autoscaled API pods spanning multiple regions or multi-primary clusters, supplement DB row locks with a short-TTL distributed lock on `pspRef` and `walletId` to shed duplicate load before hitting the database connection pool.
2. **Transactional Outbox Pattern**:
   - Rather than publishing event notifications synchronously within the HTTP request, write events (e.g. `WalletDebited`, `DepositCompleted`) to an `outbox` table in the same DB transaction. A dedicated background worker tails the outbox and streams events to Kafka or RabbitMQ.
3. **Automated Settlement & End-of-Day Reconciliation**:
   - Build an automated reconciliation worker that ingests daily batch settlement files (CSV/SFTP) from PSPs and cross-checks them against `funding_transactions` and `wallet_txs` to detect orphaned or dropped webhooks.
4. **Idempotency Key Header for Client APIs**:
   - Implement `Idempotency-Key` headers on `/deposits`, `/wagers`, and `/withdrawals` caching responses in Redis to handle network drops on mobile clients.

---

## 5. AI Tool Usage Disclosure

In compliance with the challenge guidelines:
- **Usage**: I used an AI assistant as a pair-programming partner for boilerplate scaffolding, initial migration syntax, and writing concurrent integration test scenarios.
- **Ownership**: I personally designed, reviewed, and own every architectural pattern, database schema choice, row-level locking strategy, and error-handling policy implemented in this repository.
