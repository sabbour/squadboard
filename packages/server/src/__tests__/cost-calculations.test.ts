/**
 * cost-calculations.test.ts — W28 Cost fixes verification
 *
 * Verifies COST-1 (Haiku rates), COST-2 (missing models), and COST-4 (consult premium requests).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { estimateCost, estimatePremiumRequests, getPricing, getModelMultiplier } from '../sdk/pricing.js';

describe('COST-1: Claude Haiku 4.5 rates fix', () => {
  it('should have correct Haiku input rate: 1.00 USD/M', () => {
    const pricing = getPricing('claude-haiku-4.5');
    expect(pricing.input).toBe(1.00);
  });

  it('should have correct Haiku output rate: 5.00 USD/M', () => {
    const pricing = getPricing('claude-haiku-4.5');
    expect(pricing.output).toBe(5.00);
  });

  it('should compute correct cost for Haiku: 1M input + 1M output = $6.00', () => {
    const cost = estimateCost('claude-haiku-4.5', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(6.0, 2);
  });

  it('should have correct Haiku premium multiplier: 0.25×', () => {
    const multiplier = getModelMultiplier('claude-haiku-4.5');
    expect(multiplier).toBe(0.25);
  });
});

describe('COST-1: OpenAI GPT rate fixes', () => {
  it('GPT-4.1 should have correct input rate: 2.00 USD/M', () => {
    const pricing = getPricing('gpt-4.1');
    expect(pricing.input).toBe(2.0);
  });

  it('GPT-4.1 should have correct output rate: 8.00 USD/M', () => {
    const pricing = getPricing('gpt-4.1');
    expect(pricing.output).toBe(8);
  });

  it('GPT-5-mini should have correct input rate: 0.25 USD/M', () => {
    const pricing = getPricing('gpt-5-mini');
    expect(pricing.input).toBe(0.25);
  });

  it('GPT-5-mini should have correct output rate: 2.00 USD/M', () => {
    const pricing = getPricing('gpt-5-mini');
    expect(pricing.output).toBe(2.00);
  });

  it('GPT-5.4-mini should have correct input rate: 0.75 USD/M', () => {
    const pricing = getPricing('gpt-5.4-mini');
    expect(pricing.input).toBe(0.75);
  });

  it('GPT-5.4-mini should have correct output rate: 4.50 USD/M', () => {
    const pricing = getPricing('gpt-5.4-mini');
    expect(pricing.output).toBe(4.50);
  });

  it('GPT-4.1 should be included (0 premium requests)', () => {
    const multiplier = getModelMultiplier('gpt-4.1');
    expect(multiplier).toBe(0);
  });

  it('GPT-5-mini should be included (0 premium requests)', () => {
    const multiplier = getModelMultiplier('gpt-5-mini');
    expect(multiplier).toBe(0);
  });

  it('GPT-5.4-mini should be included (0 premium requests)', () => {
    const multiplier = getModelMultiplier('gpt-5.4-mini');
    expect(multiplier).toBe(0);
  });
});

describe('COST-2: Missing model entries', () => {
  describe('GPT-5.5', () => {
    it('should exist with input rate: 5.00 USD/M', () => {
      const pricing = getPricing('gpt-5.5');
      expect(pricing.input).toBe(5.00);
    });

    it('should have output rate: 30.00 USD/M', () => {
      const pricing = getPricing('gpt-5.5');
      expect(pricing.output).toBe(30.00);
    });

    it('should have 1× premium multiplier', () => {
      const multiplier = getModelMultiplier('gpt-5.5');
      expect(multiplier).toBe(1);
    });
  });

  describe('Gemini models', () => {
    it('gemini-2.5-pro should exist with input rate: 1.25 USD/M', () => {
      const pricing = getPricing('gemini-2.5-pro');
      expect(pricing.input).toBe(1.25);
    });

    it('gemini-2.5-pro should have output rate: 10.00 USD/M', () => {
      const pricing = getPricing('gemini-2.5-pro');
      expect(pricing.output).toBe(10.00);
    });

    it('gemini-3-flash should exist with input rate: 0.50 USD/M', () => {
      const pricing = getPricing('gemini-3-flash');
      expect(pricing.input).toBe(0.50);
    });

    it('gemini-3-flash should have output rate: 3.00 USD/M', () => {
      const pricing = getPricing('gemini-3-flash');
      expect(pricing.output).toBe(3.00);
    });

    it('gemini-3.1-pro should exist with input rate: 2.00 USD/M', () => {
      const pricing = getPricing('gemini-3.1-pro');
      expect(pricing.input).toBe(2.00);
    });

    it('gemini-3.1-pro should have output rate: 12.00 USD/M', () => {
      const pricing = getPricing('gemini-3.1-pro');
      expect(pricing.output).toBe(12.00);
    });

    it('gemini-2.5-pro should have 1× premium multiplier', () => {
      const multiplier = getModelMultiplier('gemini-2.5-pro');
      expect(multiplier).toBe(1);
    });

    it('gemini-3-flash should have 1× premium multiplier', () => {
      const multiplier = getModelMultiplier('gemini-3-flash');
      expect(multiplier).toBe(1);
    });

    it('gemini-3.1-pro should have 1× premium multiplier', () => {
      const multiplier = getModelMultiplier('gemini-3.1-pro');
      expect(multiplier).toBe(1);
    });
  });

  describe('Claude Opus 4.7 variants', () => {
    it('claude-opus-4-7 should exist with input rate: 15.00 USD/M', () => {
      const pricing = getPricing('claude-opus-4-7');
      expect(pricing.input).toBe(15.00);
    });

    it('claude-opus-4-7 should have output rate: 75.00 USD/M', () => {
      const pricing = getPricing('claude-opus-4-7');
      expect(pricing.output).toBe(75.00);
    });

    it('claude-opus-4-7-1m-internal should exist with premium rates', () => {
      const pricing = getPricing('claude-opus-4-7-1m-internal');
      expect(pricing.input).toBe(15.00);
      expect(pricing.output).toBe(75.00);
    });

    it('claude-opus-4-7-high should exist with premium rates', () => {
      const pricing = getPricing('claude-opus-4-7-high');
      expect(pricing.input).toBe(15.00);
      expect(pricing.output).toBe(75.00);
    });

    it('claude-opus-4-7-xhigh should exist with premium rates', () => {
      const pricing = getPricing('claude-opus-4-7-xhigh');
      expect(pricing.input).toBe(15.00);
      expect(pricing.output).toBe(75.00);
    });

    it('claude-opus-4-7 should have 10× premium multiplier', () => {
      const multiplier = getModelMultiplier('claude-opus-4-7');
      expect(multiplier).toBe(10);
    });

    it('claude-opus-4-7-1m-internal should have 10× premium multiplier', () => {
      const multiplier = getModelMultiplier('claude-opus-4-7-1m-internal');
      expect(multiplier).toBe(10);
    });

    it('claude-opus-4-7-high should have 10× premium multiplier', () => {
      const multiplier = getModelMultiplier('claude-opus-4-7-high');
      expect(multiplier).toBe(10);
    });

    it('claude-opus-4-7-xhigh should have 10× premium multiplier', () => {
      const multiplier = getModelMultiplier('claude-opus-4-7-xhigh');
      expect(multiplier).toBe(10);
    });
  });

  describe('Fine-tuned models', () => {
    it('raptor-mini should exist with input rate: 0.25 USD/M', () => {
      const pricing = getPricing('raptor-mini');
      expect(pricing.input).toBe(0.25);
    });

    it('raptor-mini should have output rate: 2.00 USD/M', () => {
      const pricing = getPricing('raptor-mini');
      expect(pricing.output).toBe(2.00);
    });

    it('raptor-mini should be included (0 premium requests)', () => {
      const multiplier = getModelMultiplier('raptor-mini');
      expect(multiplier).toBe(0);
    });

    it('goldeneye should exist with input rate: 1.25 USD/M', () => {
      const pricing = getPricing('goldeneye');
      expect(pricing.input).toBe(1.25);
    });

    it('goldeneye should have output rate: 10.00 USD/M', () => {
      const pricing = getPricing('goldeneye');
      expect(pricing.output).toBe(10.00);
    });

    it('goldeneye should have 1× premium multiplier', () => {
      const multiplier = getModelMultiplier('goldeneye');
      expect(multiplier).toBe(1);
    });
  });
});

describe('COST-4: Premium request multiplier logic (verification)', () => {
  it('opus models should consume 10× premium requests', () => {
    const requests = estimatePremiumRequests('claude-opus-4.5');
    expect(requests).toBe(10);
  });

  it('sonnet models should consume 1× premium requests', () => {
    const requests = estimatePremiumRequests('claude-sonnet-4.6');
    expect(requests).toBe(1);
  });

  it('haiku models should consume 0.25× premium requests', () => {
    const requests = estimatePremiumRequests('claude-haiku-4.5');
    expect(requests).toBe(0.25);
  });

  it('included models (gpt-5-mini) should consume 0 premium requests', () => {
    const requests = estimatePremiumRequests('gpt-5-mini');
    expect(requests).toBe(0);
  });

  it('standard models (gpt-5.4) should consume 1× premium requests', () => {
    const requests = estimatePremiumRequests('gpt-5.4');
    expect(requests).toBe(1);
  });

  it('auto-select discount should apply 10% reduction', () => {
    const baseRequests = estimatePremiumRequests('gpt-5.4');
    const discountedRequests = estimatePremiumRequests('gpt-5.4', { autoSelect: true });
    expect(discountedRequests).toBeCloseTo(baseRequests * 0.9, 4);
  });

  it('FedRAMP surcharge should apply 10% increase', () => {
    const baseRequests = estimatePremiumRequests('gpt-5.4');
    const surchargedRequests = estimatePremiumRequests('gpt-5.4', { dataResidency: true });
    expect(surchargedRequests).toBeCloseTo(baseRequests * 1.1, 4);
  });

  it('combined auto-select + FedRAMP should be neutral (0.9 × 1.1 = 0.99)', () => {
    const baseRequests = estimatePremiumRequests('gpt-5.4');
    const combined = estimatePremiumRequests('gpt-5.4', { autoSelect: true, dataResidency: true });
    expect(combined).toBeCloseTo(baseRequests * 0.99, 4);
  });

  it('multiple prompts should multiply the base multiplier', () => {
    const singlePrompt = estimatePremiumRequests('gpt-5.4', { prompts: 1 });
    const twoPrompts = estimatePremiumRequests('gpt-5.4', { prompts: 2 });
    expect(twoPrompts).toBeCloseTo(singlePrompt * 2, 4);
  });
});

describe('Fallback behavior', () => {
  it('unknown models should fall back to reasonable defaults', () => {
    const pricing = getPricing('unknown-model-xyz');
    expect(pricing.input).toBeDefined();
    expect(pricing.output).toBeDefined();
    expect(pricing.input > 0).toBe(true);
    expect(pricing.output > 0).toBe(true);
  });

  it('unknown models should fall back to default multiplier of 1×', () => {
    const multiplier = getModelMultiplier('unknown-model-xyz');
    expect(multiplier).toBe(1);
  });
});
