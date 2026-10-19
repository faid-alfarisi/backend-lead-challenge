import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Member, Wallet, FundingTransaction } from '../src/db/models';

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

describe('POST /deposits', () => {
  it('creates a pending deposit and generates a pspRef without moving money', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'testuser' });
    const memberId = memberRes.body.member.id;

    const res = await request(app).post('/deposits').send({
      memberId,
      amount: '100.50',
      turnoverMultiplier: 2,
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.pspRef).toBeDefined();
    expect(res.body.status).toBe('pending');
    expect(res.body.amount).toBe('100.500000000000000000');
    expect(res.body.turnoverMultiplier).toBe(2);

    // Verify DB record
    const tx = await FundingTransaction.findByPk(res.body.id);
    expect(tx).not.toBeNull();
    expect(tx?.status).toBe('pending');
    expect(tx?.pspRef).toBe(res.body.pspRef);

    // Verify wallet balance is unchanged
    const walletRes = await request(app).get(`/members/${memberId}/wallet`);
    expect(walletRes.body.balance).toBe('0.000000000000000000');
  });

  it('defaults turnoverMultiplier to 1 if not provided', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'testuser2' });
    const memberId = memberRes.body.member.id;

    const res = await request(app).post('/deposits').send({
      memberId,
      amount: '50.00',
    });

    expect(res.status).toBe(201);
    expect(res.body.turnoverMultiplier).toBe(1);
  });

  it('rejects invalid or non-positive amount', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'testuser3' });
    const memberId = memberRes.body.member.id;

    const negativeRes = await request(app).post('/deposits').send({
      memberId,
      amount: '-10.00',
    });
    expect(negativeRes.status).toBe(400);

    const zeroRes = await request(app).post('/deposits').send({
      memberId,
      amount: '0',
    });
    expect(zeroRes.status).toBe(400);

    const stringRes = await request(app).post('/deposits').send({
      memberId,
      amount: 'abc',
    });
    expect(stringRes.status).toBe(400);
  });

  it('rejects negative turnoverMultiplier', async () => {
    const memberRes = await request(app).post('/members').send({ username: 'testuser4' });
    const memberId = memberRes.body.member.id;

    const res = await request(app).post('/deposits').send({
      memberId,
      amount: '10.00',
      turnoverMultiplier: -1,
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown memberId', async () => {
    const res = await request(app).post('/deposits').send({
      memberId: '00000000-0000-0000-0000-000000000000',
      amount: '10.00',
    });
    expect(res.status).toBe(404);
  });
});

