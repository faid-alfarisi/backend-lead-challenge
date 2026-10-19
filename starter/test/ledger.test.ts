import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet, WalletTx } from '../src/db/models';
import { dec, ZERO } from '../src/lib/money';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Ledger Invariants & Balance Reconstructibility', () => {
  it('guarantees wallet balance is exactly reconstructible from append-only ledger entries', async () => {
    // 1. Create member
    const memberRes = await request(app).post('/members').send({ username: 'audit_user' });
    const memberId = memberRes.body.member.id;
    const walletId = memberRes.body.wallet.id;

    // Helper for deposit
    const deposit = async (amount: string, turnoverMultiplier = 1) => {
      const depRes = await request(app).post('/deposits').send({
        memberId,
        amount,
        turnoverMultiplier,
      });
      await request(app).post('/psp/callbacks').send({
        pspRef: depRes.body.pspRef,
        status: 'completed',
        amount,
      });
    };

    // Helper for wager
    const wager = async (amount: string) => {
      await request(app).post(`/wallets/${walletId}/wagers`).send({ amount });
    };

    // Helper for withdrawal
    const withdraw = async (amount: string) => {
      await request(app).post('/withdrawals').send({ memberId, amount });
    };

    // 2. Perform a realistic sequence of transactions
    // Deposit 1: +500.00 (turnover req: 500)
    await deposit('500.00', 1);

    // Deposit 2: +250.50 (turnover req: 0)
    await deposit('250.50', 0);

    // Wager 1: -100.00 (turnover accrued: 100)
    await wager('100.00');

    // Wager 2: -75.25 (turnover accrued: 175.25)
    await wager('75.25');

    // Wager 3: -324.75 (turnover accrued: 500 -> meets turnover requirement!)
    await wager('324.75');

    // Withdrawal 1: -150.00
    await withdraw('150.00');

    // Deposit 3: +100.00
    await deposit('100.00', 0);

    // Wager 4: -50.00
    await wager('50.00');

    // 3. Fetch current wallet from database
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet).not.toBeNull();

    // 4. Fetch all ledger transactions ordered by creation
    const txs = await WalletTx.findAll({
      where: { walletId },
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    });

    // Expect 8 operations (3 deposits + 4 wagers + 1 withdrawal)
    expect(txs).toHaveLength(8);

    // 5. Reconstruct balance from ledger deltas and verify chain integrity
    let runningBalance = ZERO;

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const txAmount = dec(tx.amount);
      const before = dec(tx.balanceBefore);
      const after = dec(tx.balanceAfter);

      // Verify chain continuity: each entry's before balance equals previous entry's after balance
      expect(before.toFixed(18)).toBe(runningBalance.toFixed(18));

      // Verify row balance delta
      if (tx.type === 'deposit') {
        expect(before.plus(txAmount).toFixed(18)).toBe(after.toFixed(18));
        runningBalance = runningBalance.plus(txAmount);
      } else if (tx.type === 'wager' || tx.type === 'withdrawal') {
        expect(before.minus(txAmount).toFixed(18)).toBe(after.toFixed(18));
        runningBalance = runningBalance.minus(txAmount);
      } else {
        throw new Error(`Unknown transaction type: ${tx.type}`);
      }

      expect(runningBalance.toFixed(18)).toBe(after.toFixed(18));
    }

    // 6. Verify final reconstructed balance matches current wallet balance exactly
    expect(runningBalance.toFixed(18)).toBe(wallet!.balance);
    // Calculated: 500 + 250.50 - 100 - 75.25 - 324.75 - 150 + 100 - 50 = 150.50
    expect(wallet!.balance).toBe('150.500000000000000000');
  });
});

