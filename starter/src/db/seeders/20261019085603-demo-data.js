'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const aliceMemberId = '11111111-1111-1111-1111-111111111111';
    const aliceWalletId = '22222222-2222-2222-2222-222222222222';
    const aliceFundingId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    const bobMemberId = '33333333-3333-3333-3333-333333333333';
    const bobWalletId = '44444444-4444-4444-4444-444444444444';
    const bobFundingId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    // 1. Insert Members
    await queryInterface.bulkInsert('members', [
      {
        id: aliceMemberId,
        username: 'demo_alice',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: bobMemberId,
        username: 'demo_bob',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    // 2. Insert Wallets
    // Alice: $150 balance, requires $200 turnover, has accrued $50 (Turnover locked: $150 outstanding)
    // Bob: $300 balance, requires $100 turnover, has accrued $100 (Turnover satisfied: can withdraw!)
    await queryInterface.bulkInsert('wallets', [
      {
        id: aliceWalletId,
        member_id: aliceMemberId,
        balance: '150.000000000000000000',
        turnover_required: '200.000000000000000000',
        turnover_accrued: '50.000000000000000000',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: bobWalletId,
        member_id: bobMemberId,
        balance: '300.000000000000000000',
        turnover_required: '100.000000000000000000',
        turnover_accrued: '100.000000000000000000',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    // 3. Insert Completed Deposit Funding Transactions
    await queryInterface.bulkInsert('funding_transactions', [
      {
        id: aliceFundingId,
        member_id: aliceMemberId,
        wallet_id: aliceWalletId,
        type: 'deposit',
        amount: '200.000000000000000000',
        turnover_multiplier: 1,
        status: 'completed',
        psp_ref: 'demo_psp_ref_alice_001',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: bobFundingId,
        member_id: bobMemberId,
        wallet_id: bobWalletId,
        type: 'deposit',
        amount: '400.000000000000000000',
        turnover_multiplier: 0,
        status: 'completed',
        psp_ref: 'demo_psp_ref_bob_001',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    // 4. Insert Ledger Entries
    await queryInterface.bulkInsert('wallet_txs', [
      // Alice deposit: +200
      {
        id: '11111111-aaaa-1111-aaaa-111111111111',
        wallet_id: aliceWalletId,
        funding_tx_id: aliceFundingId,
        type: 'deposit',
        amount: '200.000000000000000000',
        balance_before: '0.000000000000000000',
        balance_after: '200.000000000000000000',
        created_at: new Date(),
        updated_at: new Date(),
      },
      // Alice wager: -50
      {
        id: '22222222-aaaa-2222-aaaa-222222222222',
        wallet_id: aliceWalletId,
        funding_tx_id: null,
        type: 'wager',
        amount: '50.000000000000000000',
        balance_before: '200.000000000000000000',
        balance_after: '150.000000000000000000',
        created_at: new Date(),
        updated_at: new Date(),
      },
      // Bob deposit: +400
      {
        id: '33333333-bbbb-3333-bbbb-333333333333',
        wallet_id: bobWalletId,
        funding_tx_id: bobFundingId,
        type: 'deposit',
        amount: '400.000000000000000000',
        balance_before: '0.000000000000000000',
        balance_after: '400.000000000000000000',
        created_at: new Date(),
        updated_at: new Date(),
      },
      // Bob wager: -100
      {
        id: '44444444-bbbb-4444-bbbb-444444444444',
        wallet_id: bobWalletId,
        funding_tx_id: null,
        type: 'wager',
        amount: '100.000000000000000000',
        balance_before: '400.000000000000000000',
        balance_after: '300.000000000000000000',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('wallet_txs', null, {});
    await queryInterface.bulkDelete('funding_transactions', null, {});
    await queryInterface.bulkDelete('wallets', null, {});
    await queryInterface.bulkDelete('members', null, {});
  },
};
