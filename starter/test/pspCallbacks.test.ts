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

describe('POST /psp/callbacks', () => {
  it('credits the wallet and creates a ledger entry on completed status', async () => {
    // 1. Setup member and deposit
    const memberRes = await request(app).post('/members').send({ username: 'bob01' });
    const memberId = memberRes.body.member.id;
    const walletId = memberRes.body.wallet.id;

    const depRes = await request(app).post('/deposits').send({
      memberId,
      amount: '100.50',
      turnoverMultiplier: 2,
    });
    const pspRef = depRes.body.pspRef;

    // 2. Deliver callback
    const callbackRes = await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'completed',
      amount: '100.50',
    });

    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.status).toBe('completed');
    expect(callbackRes.body.idempotent).toBe(false);

    // 3. Verify wallet balance and turnover required
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('100.500000000000000000');
    expect(wallet?.turnoverRequired).toBe('201.000000000000000000'); // 100.50 * 2

    // 4. Verify funding transaction status
    const tx = await FundingTransaction.findOne({ where: { pspRef } });
    expect(tx?.status).toBe('completed');

    // 5. Verify append-only ledger entry
    const ledgerEntries = await WalletTx.findAll({ where: { walletId } });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].type).toBe('deposit');
    expect(ledgerEntries[0].amount).toBe('100.500000000000000000');
    expect(ledgerEntries[0].balanceBefore).toBe('0.000000000000000000');
    expect(ledgerEntries[0].balanceAfter).toBe('100.500000000000000000');
  });

  it('sequential duplicate callback does not double-credit wallet or ledger', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'bob02' });
    const memberId = memberRes.body.member.id;
    const walletId = memberRes.body.wallet.id;

    const depRes = await request(app).post('/deposits').send({
      memberId,
      amount: '50.00',
      turnoverMultiplier: 1,
    });
    const pspRef = depRes.body.pspRef;

    // First delivery
    const res1 = await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'completed',
      amount: '50.00',
    });
    expect(res1.status).toBe(200);
    expect(res1.body.idempotent).toBe(false);

    // Second delivery (duplicate retry)
    const res2 = await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'completed',
      amount: '50.00',
    });
    expect(res2.status).toBe(200);
    expect(res2.body.idempotent).toBe(true);

    // Wallet balance must be credited exactly once
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('50.000000000000000000');

    // Exactly one ledger entry
    const ledgerEntries = await WalletTx.findAll({ where: { walletId } });
    expect(ledgerEntries).toHaveLength(1);
  });

  it('concurrent duplicate callbacks credit the wallet exactly once', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'bob03' });
    const memberId = memberRes.body.member.id;
    const walletId = memberRes.body.wallet.id;

    const depRes = await request(app).post('/deposits').send({
      memberId,
      amount: '75.00',
      turnoverMultiplier: 1,
    });
    const pspRef = depRes.body.pspRef;

    // Fire 5 identical callbacks concurrently
    const promises = Array.from({ length: 5 }, () =>
      request(app).post('/psp/callbacks').send({
        pspRef,
        status: 'completed',
        amount: '75.00',
      }),
    );

    const responses = await Promise.all(promises);

    // All should return 200
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Exactly one should be non-idempotent (the one that did the work)
    const freshProcessCount = responses.filter((r) => r.body.idempotent === false).length;
    const idempotentCount = responses.filter((r) => r.body.idempotent === true).length;
    expect(freshProcessCount).toBe(1);
    expect(idempotentCount).toBe(4);

    // Wallet balance credited only once
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('75.000000000000000000');

    // Exactly one ledger entry
    const ledgerEntries = await WalletTx.findAll({ where: { walletId } });
    expect(ledgerEntries).toHaveLength(1);
  });

  it('handles failed status without crediting wallet or creating ledger entry', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'bob04' });
    const memberId = memberRes.body.member.id;
    const walletId = memberRes.body.wallet.id;

    const depRes = await request(app).post('/deposits').send({
      memberId,
      amount: '25.00',
    });
    const pspRef = depRes.body.pspRef;

    const callbackRes = await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'failed',
      amount: '25.00',
    });

    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.status).toBe('failed');

    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('0.000000000000000000');

    const ledgerEntries = await WalletTx.findAll({ where: { walletId } });
    expect(ledgerEntries).toHaveLength(0);

    const tx = await FundingTransaction.findOne({ where: { pspRef } });
    expect(tx?.status).toBe('failed');
  });

  it('rejects callbacks with unknown pspRef', async () => {
    const res = await request(app).post('/psp/callbacks').send({
      pspRef: 'unknown_ref_123',
      status: 'completed',
      amount: '100.00',
    });

    expect(res.status).toBe(404);
  });

  it('rejects amount mismatch and prevents wallet credit', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'bob05' });
    const memberId = memberRes.body.member.id;
    const walletId = memberRes.body.wallet.id;

    const depRes = await request(app).post('/deposits').send({
      memberId,
      amount: '100.00',
    });
    const pspRef = depRes.body.pspRef;

    const res = await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'completed',
      amount: '50.00', // Mismatch!
    });

    expect(res.status).toBe(422);

    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('0.000000000000000000');

    const ledgerEntries = await WalletTx.findAll({ where: { walletId } });
    expect(ledgerEntries).toHaveLength(0);
  });

  it('rejects invalid state machine transitions', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'bob06' });
    const memberId = memberRes.body.member.id;

    const depRes = await request(app).post('/deposits').send({
      memberId,
      amount: '100.00',
    });
    const pspRef = depRes.body.pspRef;

    // Complete it first
    await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'completed',
      amount: '100.00',
    });

    // Attempt to fail an already completed transaction
    const conflictRes = await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'failed',
      amount: '100.00',
    });

    expect(conflictRes.status).toBe(409);
  });
});

