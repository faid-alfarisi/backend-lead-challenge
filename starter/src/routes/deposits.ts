import { Router } from 'express';
import { z } from 'zod';
import * as depositService from '../services/depositService';
import { dec } from '../lib/money';

export const depositsRouter = Router();

const createDepositBody = z.object({
  memberId: z.string().uuid(),
  amount: z.string().refine(
    (val) => {
      try {
        const bn = dec(val);
        return bn.isPositive() && !bn.isZero();
      } catch {
        return false;
      }
    },
    { message: 'Amount must be a positive decimal string' },
  ),
  turnoverMultiplier: z.number().int().min(0).default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const tx = await depositService.createDeposit(body);
    res.status(201).json({
      id: tx.id,
      pspRef: tx.pspRef,
      status: tx.status,
      amount: tx.amount,
      turnoverMultiplier: tx.turnoverMultiplier,
    });
  } catch (err) {
    next(err);
  }
});

