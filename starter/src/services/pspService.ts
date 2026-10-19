import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../lib/errors';

export interface HandlePspCallbackParams {
  pspRef: string;
  status: 'completed' | 'failed';
  amount: string;
}

export interface HandlePspCallbackResult {
  idempotent: boolean;
  fundingTxId: string;
  status: string;
  message?: string;
}

export async function handlePspCallback(
  params: HandlePspCallbackParams,
): Promise<HandlePspCallbackResult> {
  const { pspRef, status, amount } = params;

  return sequelize.transaction(async (t) => {
    // 1. Lock the funding transaction row to serialize concurrent callbacks
    const fundingTx = await FundingTransaction.findOne({
      where: { pspRef },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!fundingTx) {
      throw new NotFoundError(`Funding transaction not found for pspRef: ${pspRef}`);
    }

    // 2. Explicit State Machine: Pending -> Completed / Failed
    if (fundingTx.status !== 'pending') {
      if (fundingTx.status === status) {
        // Idempotent retry: already processed with this status
        return {
          idempotent: true,
          fundingTxId: fundingTx.id,
          status: fundingTx.status,
          message: 'Callback already processed',
        };
      }

      // Invalid state transition (e.g. completed -> failed or failed -> completed)
      throw new ConflictError(
        `Invalid state transition: transaction is already ${fundingTx.status}, cannot transition to ${status}`,
      );
    }

    // 3. Amount mismatch check
    const callbackAmount = dec(amount);
    const expectedAmount = dec(fundingTx.amount);
    if (!callbackAmount.isEqualTo(expectedAmount)) {
      throw new UnprocessableEntityError(
        `Amount mismatch: expected ${fundingTx.amount}, but received ${amount}`,
        { expectedAmount: fundingTx.amount, receivedAmount: amount },
      );
    }

    // 4. Lock the associated wallet row
    const wallet = await Wallet.findByPk(fundingTx.walletId, {
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!wallet) {
      throw new NotFoundError(`Wallet not found for funding transaction ${fundingTx.id}`);
    }

    if (status === 'completed') {
      const balanceBefore = dec(wallet.balance);
      const balanceAfter = balanceBefore.plus(expectedAmount);

      const requiredTurnoverIncrement = expectedAmount.times(fundingTx.turnoverMultiplier);
      const newTurnoverRequired = dec(wallet.turnoverRequired).plus(requiredTurnoverIncrement);

      // Update wallet balance and turnover requirement
      await wallet.update(
        {
          balance: balanceAfter.toFixed(18),
          turnoverRequired: newTurnoverRequired.toFixed(18),
        },
        { transaction: t },
      );

      // Write immutable append-only ledger entry
      await WalletTx.create(
        {
          walletId: wallet.id,
          fundingTxId: fundingTx.id,
          type: 'deposit',
          amount: expectedAmount.toFixed(18),
          balanceBefore: balanceBefore.toFixed(18),
          balanceAfter: balanceAfter.toFixed(18),
        },
        { transaction: t },
      );

      // Move funding transaction to completed
      await fundingTx.update({ status: 'completed' }, { transaction: t });
    } else {
      // status === 'failed': no money moves, no turnover changes
      await fundingTx.update({ status: 'failed' }, { transaction: t });
    }

    return {
      idempotent: false,
      fundingTxId: fundingTx.id,
      status: fundingTx.status,
    };
  });
}

