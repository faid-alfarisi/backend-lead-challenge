import { Router } from 'express';
import { z } from 'zod';
import * as wagerService from '../services/wagerService';
import { dec } from '../lib/money';

export const walletsRouter = Router();

const wagerParamSchema = z.object({
  walletId: z.string().uuid(),
});

const wagerBodySchema = z.object({
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
});

walletsRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const { walletId } = wagerParamSchema.parse(req.params);
    const { amount } = wagerBodySchema.parse(req.body);

    const result = await wagerService.recordWager({ walletId, amount });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
