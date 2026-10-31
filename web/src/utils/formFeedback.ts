import { message } from 'antd';
import type { FormInstance } from 'antd';

/**
 * validateFields that also shows where the problem is. On a phone the field
 * with the error is often off screen, so a failed check looked like a dead
 * button. Scrolls to the first error and shows a short message, then rethrows.
 */
export async function validateOrShow<T = Record<string, unknown>>(form: FormInstance): Promise<T> {
  try {
    return (await form.validateFields()) as T;
  } catch (err) {
    const first = (err as { errorFields?: { name: (string | number)[] }[] })?.errorFields?.[0];
    if (first) {
      form.scrollToField(first.name, { block: 'center', behavior: 'smooth' });
      message.error('Check the highlighted field.');
    }
    throw err;
  }
}

/** Scroll an element (an error banner or a row) into view and repeat the message as a toast. */
export function showFormError(text: string, target?: Element | null) {
  message.error(text);
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
