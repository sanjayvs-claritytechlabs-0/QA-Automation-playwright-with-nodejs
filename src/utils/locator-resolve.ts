import type { Page, Locator } from 'playwright';

export type LocatorInput = {
  strategy: string;
  selector: string;
  role?: string | null;
  accessible_name?: string | null;
};

export type LocatorPlan =
  | { kind: 'getByTestId'; testId: string }
  | { kind: 'getByRole'; role: string; name?: string }
  | { kind: 'getByPlaceholder'; placeholder: string }
  | { kind: 'getByLabel'; label: string }
  | { kind: 'getByText'; text: string }
  | { kind: 'css'; selector: string }
  | { kind: 'xpath'; selector: string };

/**
 * Pure mapping from PRD locator object → Playwright locator plan.
 * Used by execute + unit self-check (no Page required).
 */
export function planLocator(input: LocatorInput): LocatorPlan {
  const strategy = (input.strategy || '').toLowerCase().trim();
  const selector = (input.selector || '').trim();
  const role = (input.role || '').trim();
  const name = (input.accessible_name || '').trim();

  switch (strategy) {
    case 'testid':
    case 'data-testid':
      return { kind: 'getByTestId', testId: selector };
    case 'role': {
      const roleName = role || selector;
      return name
        ? { kind: 'getByRole', role: roleName, name }
        : { kind: 'getByRole', role: roleName };
    }
    case 'placeholder':
      return { kind: 'getByPlaceholder', placeholder: selector };
    case 'label':
      return { kind: 'getByLabel', label: selector };
    case 'text':
      return { kind: 'getByText', text: selector };
    case 'xpath':
      return {
        kind: 'xpath',
        selector: selector.startsWith('xpath=') ? selector.slice(6) : selector,
      };
    case 'css':
    default:
      return { kind: 'css', selector };
  }
}

export function buildPageLocator(page: Page, input: LocatorInput): Locator {
  const plan = planLocator(input);
  switch (plan.kind) {
    case 'getByTestId':
      return page.getByTestId(plan.testId);
    case 'getByRole':
      return plan.name
        ? page.getByRole(plan.role as Parameters<Page['getByRole']>[0], { name: plan.name })
        : page.getByRole(plan.role as Parameters<Page['getByRole']>[0]);
    case 'getByPlaceholder':
      return page.getByPlaceholder(plan.placeholder);
    case 'getByLabel':
      return page.getByLabel(plan.label);
    case 'getByText':
      return page.getByText(plan.text);
    case 'xpath':
      return page.locator(`xpath=${plan.selector}`);
    case 'css':
      return page.locator(plan.selector);
  }
}

export const STRATEGY_ALLOWLIST = new Set([
  'testid',
  'role',
  'css',
  'xpath',
  'text',
  'placeholder',
  'label',
]);
