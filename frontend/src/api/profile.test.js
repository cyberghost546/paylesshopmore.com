// updateProfile: the first and last name are sent exactly as typed in their
// own boxes, so a name with several words is never split in the wrong place.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateProfile } from './profile';

afterEach(() => vi.restoreAllMocks());

function stubFetch() {
  document.cookie = 'csrftoken=test-token';
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id: 1, first_name: 'Maria', last_name: 'de Jong' }), {
      status: 200,
    }),
  );
}

describe('updateProfile', () => {
  it('sends the first and last name as typed', async () => {
    const fetch = stubFetch();
    const saved = await updateProfile({ firstName: 'Maria', lastName: 'de Jong', email: 'm@example.com' });

    const body = JSON.parse(fetch.mock.calls.at(-1)[1].body);
    expect(body).toEqual({ first_name: 'Maria', last_name: 'de Jong', email: 'm@example.com' });
    expect(saved.name).toBe('Maria de Jong');
  });

  it('still splits the older single name box', async () => {
    const fetch = stubFetch();
    await updateProfile({ name: 'Maria de Jong' });

    const body = JSON.parse(fetch.mock.calls.at(-1)[1].body);
    expect(body).toEqual({ first_name: 'Maria', last_name: 'de Jong' });
  });
});
