import { sequelize } from '../db/sequelize';
import { FundingTransaction, Member, Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../lib/errors';

export interface CreateWithdrawalParams {
  memberId: string;
  amount: string;
}

export interface CreateWithdrawalResult {
  id: string;
  memberId: string;
  walletId: string;
  amount: string;
  status: string;
  balance: string;
}

export async function createWithdrawal(
  params: CreateWithdrawalParams,
): Promise<CreateWithdrawalResult> {
  const { memberId, amount } = params;
  const withdrawalAmount = dec(amount);

  return sequelize.transaction(async (t) => {
    const member = await Member.findByPk(memberId, { transaction: t });
    if (!member) {
      throw new NotFoundError(`Member not found: ${memberId}`);
    }

    // Row-lock the wallet
    const wallet = await Wallet.findOne({
      where: { memberId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!wallet) {
      throw new NotFoundError(`Wallet not found for member: ${memberId}`);
    }

    // Anti-abuse check: Turnover requirement lock
    const accrued = dec(wallet.turnoverAccrued);
    const required = dec(wallet.turnoverRequired);

    if (accrued.isLessThan(required)) {
      const outstanding = required.minus(accrued);
      throw new UnprocessableEntityError('Turnover requirement not met', {
        requiredTurnover: required.toFixed(18),
        accruedTurnover: accrued.toFixed(18),
        outstandingTurnover: outstanding.toFixed(18),
      });
    }

    // Balance check
    const currentBalance = dec(wallet.balance);
    if (currentBalance.isLessThan(withdrawalAmount)) {
      throw new BadRequestError('Insufficient balance for withdrawal', {
        currentBalance: wallet.balance,
        requestedAmount: amount,
      });
    }

    const newBalance = currentBalance.minus(withdrawalAmount);

    // Debit wallet immediately
    await wallet.update(
      { balance: newBalance.toFixed(18) },
      { transaction: t },
    );

    // Create funding transaction in Pending state
    const fundingTx = await FundingTransaction.create(
      {
        memberId,
        walletId: wallet.id,
        type: 'withdrawal',
        amount: withdrawalAmount.toFixed(18),
        turnoverMultiplier: 0,
        status: 'pending',
        pspRef: null,
      },
      { transaction: t },
    );

    // Write append-only ledger entry
    await WalletTx.create(
      {
        walletId: wallet.id,
        fundingTxId: fundingTx.id,
        type: 'withdrawal',
        amount: withdrawalAmount.toFixed(18),
        balanceBefore: currentBalance.toFixed(18),
        balanceAfter: newBalance.toFixed(18),
      },
      { transaction: t },
    );

    return {
      id: fundingTx.id,
      memberId,
      walletId: wallet.id,
      amount: withdrawalAmount.toFixed(18),
      status: fundingTx.status,
      balance: newBalance.toFixed(18),
    };
  });
}

