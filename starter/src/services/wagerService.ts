import { sequelize } from '../db/sequelize';
import { Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { BadRequestError, NotFoundError } from '../lib/errors';

export interface RecordWagerParams {
  walletId: string;
  amount: string;
}

export interface RecordWagerResult {
  transactionId: string;
  walletId: string;
  amount: string;
  balance: string;
  turnoverAccrued: string;
}

export async function recordWager(
  params: RecordWagerParams,
): Promise<RecordWagerResult> {
  const { walletId, amount } = params;
  const wagerAmount = dec(amount);

  return sequelize.transaction(async (t) => {
    // Lock the wallet row to prevent concurrent overdraws
    const wallet = await Wallet.findByPk(walletId, {
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!wallet) {
      throw new NotFoundError(`Wallet not found: ${walletId}`);
    }

    const currentBalance = dec(wallet.balance);

    if (currentBalance.isLessThan(wagerAmount)) {
      throw new BadRequestError('Insufficient balance', {
        currentBalance: wallet.balance,
        requestedAmount: amount,
      });
    }

    const newBalance = currentBalance.minus(wagerAmount);
    const newTurnoverAccrued = dec(wallet.turnoverAccrued).plus(wagerAmount);

    await wallet.update(
      {
        balance: newBalance.toFixed(18),
        turnoverAccrued: newTurnoverAccrued.toFixed(18),
      },
      { transaction: t },
    );

    const ledgerEntry = await WalletTx.create(
      {
        walletId: wallet.id,
        fundingTxId: null,
        type: 'wager',
        amount: wagerAmount.toFixed(18),
        balanceBefore: currentBalance.toFixed(18),
        balanceAfter: newBalance.toFixed(18),
      },
      { transaction: t },
    );

    return {
      transactionId: ledgerEntry.id,
      walletId: wallet.id,
      amount: wagerAmount.toFixed(18),
      balance: newBalance.toFixed(18),
      turnoverAccrued: newTurnoverAccrued.toFixed(18),
    };
  });
}
