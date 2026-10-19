import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet, WalletTx } from '../src/db/models';

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

async function createMemberWithBalance(username: string, amount: string): Promise<{ memberId: string; walletId: string }> {
  const memberRes = await request(app).post('/members').send({ username });
  const memberId = memberRes.body.member.id;
  const walletId = memberRes.body.wallet.id;

  const depRes = await request(app).post('/deposits').send({ memberId, amount });
  await request(app).post('/psp/callbacks').send({
    pspRef: depRes.body.pspRef,
    status: 'completed',
    amount,
  });

  return { memberId, walletId };
}

describe('POST /wallets/:walletId/wagers', () => {
  it('debits the wallet, accrues turnover, and writes a ledger entry', async () => {
    const { walletId } = await createMemberWithBalance('wagerer1', '100.00');

    const res = await request(app)
      .post(`/wallets/${walletId}/wagers`)
      .send({ amount: '35.50' });

    expect(res.status).toBe(201);
    expect(res.body.balance).toBe('64.500000000000000000');
    expect(res.body.turnoverAccrued).toBe('35.500000000000000000');

    // Verify DB
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('64.500000000000000000');
    expect(wallet?.turnoverAccrued).toBe('35.500000000000000000');

    // Verify ledger
    const ledger = await WalletTx.findAll({ where: { walletId, type: 'wager' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe('35.500000000000000000');
    expect(ledger[0].balanceBefore).toBe('100.000000000000000000');
    expect(ledger[0].balanceAfter).toBe('64.500000000000000000');
  });

  it('rejects wager if wallet has insufficient balance', async () => {
    const { walletId } = await createMemberWithBalance('wagerer2', '20.00');

    const res = await request(app)
      .post(`/wallets/${walletId}/wagers`)
      .send({ amount: '50.00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Insufficient balance');

    // Balance and turnover unchanged
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('20.000000000000000000');
    expect(wallet?.turnoverAccrued).toBe('0.000000000000000000');
  });

  it('rejects invalid or non-positive amount', async () => {
    const { walletId } = await createMemberWithBalance('wagerer3', '50.00');

    const resNegative = await request(app)
      .post(`/wallets/${walletId}/wagers`)
      .send({ amount: '-5.00' });
    expect(resNegative.status).toBe(400);

    const resZero = await request(app)
      .post(`/wallets/${walletId}/wagers`)
      .send({ amount: '0' });
    expect(resZero.status).toBe(400);
  });

  it('returns 404 for unknown walletId', async () => {
    const res = await request(app)
      .post('/wallets/00000000-0000-0000-0000-000000000000/wagers')
      .send({ amount: '10.00' });
    expect(res.status).toBe(404);
  });

  it('concurrent wagers cannot overdraw a wallet', async () => {
    // Start with $50.00 balance
    const { walletId } = await createMemberWithBalance('wagerer4', '50.00');

    // Send 5 concurrent wagers of $20.00 each (Total: $100.00 requested)
    const promises = Array.from({ length: 5 }, () =>
      request(app)
        .post(`/wallets/${walletId}/wagers`)
        .send({ amount: '20.00' }),
    );

    const responses = await Promise.all(promises);

    const successResponses = responses.filter((r) => r.status === 201);
    const failedResponses = responses.filter((r) => r.status === 400);

    // Exactly 2 wagers should succeed ($40 total debited), 3 should fail
    expect(successResponses).toHaveLength(2);
    expect(failedResponses).toHaveLength(3);

    // Remaining balance must be exactly $10.00
    const wallet = await Wallet.findByPk(walletId);
    expect(wallet?.balance).toBe('10.000000000000000000');
    expect(wallet?.turnoverAccrued).toBe('40.000000000000000000');

    // Exactly 2 ledger entries for wagers
    const wagerLedgers = await WalletTx.findAll({ where: { walletId, type: 'wager' } });
    expect(wagerLedgers).toHaveLength(2);
  });
});

