import crypto from 'crypto';
import { FundingTransaction, Member, Wallet } from '../db/models';
import { dec } from '../lib/money';
import { NotFoundError } from '../lib/errors';

export interface CreateDepositParams {
  memberId: string;
  amount: string;
  turnoverMultiplier?: number;
}

export async function createDeposit(params: CreateDepositParams): Promise<FundingTransaction> {
  const { memberId, amount, turnoverMultiplier = 1 } = params;

  const member = await Member.findByPk(memberId, {
    include: [{ model: Wallet, as: 'wallet' }],
  });

  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const wallet = (member as any).wallet || (await Wallet.findOne({ where: { memberId } }));
  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const pspRef = `psp_dep_${crypto.randomUUID()}`;

  const fundingTx = await FundingTransaction.create({
    memberId,
    walletId: wallet.id,
    type: 'deposit',
    amount: dec(amount).toFixed(18),
    turnoverMultiplier,
    status: 'pending',
    pspRef,
  });

  return fundingTx;
}

