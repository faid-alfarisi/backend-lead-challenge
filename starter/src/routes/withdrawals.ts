import { Router } from 'express';
import { z } from 'zod';
import * as withdrawalService from '../services/withdrawalService';
import { dec } from '../lib/money';

export const withdrawalsRouter = Router();

const createWithdrawalBody = z.object({
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
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = createWithdrawalBody.parse(req.body);
    const result = await withdrawalService.createWithdrawal(body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

