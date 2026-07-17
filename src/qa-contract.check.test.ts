import { normalizeUrl, isSameOrigin } from './utils/url';
import { planLocator } from './utils/locator-resolve';
import { executeRequestSchema } from './schemas/qa.schema';

/**
 * Runnable self-check (ponytail): URL normalize + locator plan mapping + execute schema.
 * Run: npx jest src/qa-contract.check.test.ts
 */
describe('QA contract helpers', () => {
  test('normalizeUrl strips trailing slash and fragment', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    expect(normalizeUrl('https://example.com/a#section')).toBe('https://example.com/a');
    expect(normalizeUrl('/login', 'https://example.com')).toBe('https://example.com/login');
    expect(normalizeUrl('ftp://bad.example')).toBeNull();
  });

  test('isSameOrigin compares host+protocol', () => {
    expect(isSameOrigin('https://a.com/x', 'https://a.com/y')).toBe(true);
    expect(isSameOrigin('https://a.com', 'https://b.com')).toBe(false);
    expect(isSameOrigin('http://a.com', 'https://a.com')).toBe(false);
  });

  test('planLocator prefers PRD strategy mapping', () => {
    expect(planLocator({ strategy: 'testid', selector: 'email' })).toEqual({
      kind: 'getByTestId',
      testId: 'email',
    });
    expect(
      planLocator({
        strategy: 'role',
        selector: 'button',
        role: 'button',
        accessible_name: 'Sign in',
      })
    ).toEqual({ kind: 'getByRole', role: 'button', name: 'Sign in' });
    expect(planLocator({ strategy: 'placeholder', selector: 'Email' })).toEqual({
      kind: 'getByPlaceholder',
      placeholder: 'Email',
    });
    expect(planLocator({ strategy: 'label', selector: 'Password' })).toEqual({
      kind: 'getByLabel',
      label: 'Password',
    });
    expect(planLocator({ strategy: 'text', selector: 'Forgot' })).toEqual({
      kind: 'getByText',
      text: 'Forgot',
    });
    expect(planLocator({ strategy: 'xpath', selector: '//div[@id="x"]' })).toEqual({
      kind: 'xpath',
      selector: '//div[@id="x"]',
    });
    expect(planLocator({ strategy: 'css', selector: '.btn.primary' })).toEqual({
      kind: 'css',
      selector: '.btn.primary',
    });
  });

  test('executeRequestSchema coerces boolean/number expected and value', () => {
    const parsed = executeRequestSchema.safeParse({
      base_url: 'https://example.com',
      cases: [
        {
          test_case_id: 'tc-1',
          steps: [{ action: 'wait', value: 500, description: null }],
          assertions: [{ type: 'visible', expected: true }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.cases[0].steps[0].value).toBe('500');
    expect(parsed.data.cases[0].assertions?.[0].expected).toBe('true');
  });
});
