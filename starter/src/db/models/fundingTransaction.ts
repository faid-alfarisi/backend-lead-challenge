import { DataTypes, Model, Sequelize } from 'sequelize';

export type FundingTransactionType = 'deposit' | 'withdrawal';
export type FundingTransactionStatus = 'pending' | 'completed' | 'failed';

export class FundingTransaction extends Model {
  declare id: string;
  declare memberId: string;
  declare walletId: string;
  declare type: FundingTransactionType;
  declare amount: string;
  declare turnoverMultiplier: number;
  declare status: FundingTransactionStatus;
  declare pspRef: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      walletId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      pspRef: { type: DataTypes.STRING, allowNull: true, unique: true },
    },
    { sequelize, tableName: 'funding_transactions', underscored: true },
  );
}

