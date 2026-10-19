import { Router } from 'express';
import { z } from 'zod';
import * as pspService from '../services/pspService';
import { dec } from '../lib/money';

export const pspRouter = Router();

const pspCallbackBody = z.object({
  pspRef: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  amount: z.string().refine(
    (val) => {
      try {
        const bn = dec(val);
        return bn.isFinite();
      } catch {
        return false;
      }
    },
    { message: 'Amount must be a valid decimal string' },
  ),
});

pspRouter.post('/callbacks', async (req, res, next) => {
  try {
    const body = pspCallbackBody.parse(req.body);
    const result = await pspService.handlePspCallback(body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

