import { DataTypes, Model, Sequelize } from 'sequelize';

export type WalletTxType = 'deposit' | 'wager' | 'withdrawal';

export class WalletTx extends Model {
  declare id: string;
  declare walletId: string;
  declare fundingTxId: string | null;
  declare type: WalletTxType;
  declare amount: string;
  declare balanceBefore: string;
  declare balanceAfter: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      fundingTxId: { type: DataTypes.UUID, allowNull: true },
      type: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      balanceBefore: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      balanceAfter: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    },
    { sequelize, tableName: 'wallet_txs', underscored: true },
  );
}

