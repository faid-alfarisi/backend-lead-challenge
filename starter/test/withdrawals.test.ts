import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../src/db/models';

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

async function setupMemberWithDeposit(
  username: string,
  amount: string,
  turnoverMultiplier = 1,
): Promise<{ memberId: string; walletId: string }> {
  const memberRes = await request(app).post('/members').send({ username });
  const memberId = memberRes.body.member.id;
  const walletId = memberRes.body.wallet.id;

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

  return { memberId, walletId };
}

describe('POST /withdrawals', () => {
  it('blocks withdrawal with 422 and tells client outstanding turnover when requirement is not met', async () => {
    // Deposit 100 with multiplier 1 -> required turnover = 100
    const { memberId, walletId } = await setupMemberWithDeposit('charlie01', '100.00', 1);

    // Attempt withdrawal with 0 turnover accrued
    const res = await request(app).post('/withdrawals').send({
      memberId,
      amount: '50.00',
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Turnover requirement not met');
    expect(res.body.requiredTurnover).toBe('100.000000000000000000');
    expect(res.body.accruedTurnover).toBe('0.000000000000000000');
    expect(res.body.outstandingTurnover).toBe('100.000000000000000000');

    // Wallet balance and ledger must be unaffected
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('100.000000000000000000');

    const withdrawalTxs = await WalletTx.findAll({ where: { walletId, type: 'withdrawal' } });
    expect(withdrawalTxs).toHaveLength(0);
  });

  it('unblocks withdrawal once accrued turnover >= required turnover', async () => {
    // Deposit 1: 100.00 with multiplier 1 -> required turnover = 100.00
    const { memberId, walletId } = await setupMemberWithDeposit('charlie02', '100.00', 1);

    // Deposit 2: 100.00 with multiplier 0 -> required turnover still 100.00, balance = 200.00
    const depRes2 = await request(app).post('/deposits').send({
      memberId,
      amount: '100.00',
      turnoverMultiplier: 0,
    });
    await request(app).post('/psp/callbacks').send({
      pspRef: depRes2.body.pspRef,
      status: 'completed',
      amount: '100.00',
    });

    // Partial wager: 40.00 -> balance becomes 160.00, accrued = 40.00
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '40.00' });

    // Try withdraw -> still blocked, 60.00 outstanding
    const blockedRes = await request(app).post('/withdrawals').send({
      memberId,
      amount: '50.00',
    });
    expect(blockedRes.status).toBe(422);
    expect(blockedRes.body.outstandingTurnover).toBe('60.000000000000000000');

    // Complete remaining wager: 60.00 -> balance becomes 100.00, accrued = 100.00 >= required
    await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '60.00' });

    // Now withdraw 50.00 -> should succeed!
    const successRes = await request(app).post('/withdrawals').send({
      memberId,
      amount: '50.00',
    });

    expect(successRes.status).toBe(201);
    expect(successRes.body.id).toBeDefined();
    expect(successRes.body.status).toBe('pending');
    expect(successRes.body.balance).toBe('50.000000000000000000');

    // Check DB
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('50.000000000000000000');

    // Verify FundingTransaction was created in Pending state
    const fundingTx = await FundingTransaction.findByPk(successRes.body.id);
    expect(fundingTx?.type).toBe('withdrawal');
    expect(fundingTx?.status).toBe('pending');
    expect(fundingTx?.amount).toBe('50.000000000000000000');

    // Verify ledger entry
    const ledger = await WalletTx.findOne({ where: { fundingTxId: successRes.body.id } });
    expect(ledger?.type).toBe('withdrawal');
    expect(ledger?.amount).toBe('50.000000000000000000');
    expect(ledger?.balanceBefore).toBe('100.000000000000000000');
    expect(ledger?.balanceAfter).toBe('50.000000000000000000');
  });

  it('rejects withdrawal when balance is insufficient even if turnover is satisfied', async () => {
    // Deposit 50.00 with multiplier 0 -> required turnover = 0
    const { memberId, walletId } = await setupMemberWithDeposit('charlie03', '50.00', 0);

    const res = await request(app).post('/withdrawals').send({
      memberId,
      amount: '100.00',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Insufficient balance for withdrawal');

    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('50.000000000000000000');
  });

  it('returns 404 for unknown memberId', async () => {
    const res = await request(app).post('/withdrawals').send({
      memberId: '00000000-0000-0000-0000-000000000000',
      amount: '50.00',
    });
    expect(res.status).toBe(404);
  });

  it('concurrent withdrawals cannot overdraw the wallet', async () => {
    // Setup member with 100 balance and 0 turnover requirement
    const { memberId, walletId } = await setupMemberWithDeposit('charlie04', '100.00', 0);

    // Two simultaneous withdrawal attempts for 70.00 each (Total 140.00)
    const [res1, res2] = await Promise.all([
      request(app).post('/withdrawals').send({ memberId, amount: '70.00' }),
      request(app).post('/withdrawals').send({ memberId, amount: '70.00' }),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(400);

    // Remaining balance must be exactly 30.00
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('30.000000000000000000');

    // Exactly one withdrawal ledger entry
    const ledgers = await WalletTx.findAll({ where: { walletId, type: 'withdrawal' } });
    expect(ledgers).toHaveLength(1);
  });
});

