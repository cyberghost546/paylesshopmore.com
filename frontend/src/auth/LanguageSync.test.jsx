// LanguageSync: the account learns the site language, so e-mails use it.

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfileLanguage } from '../api/profile';
import LanguageSync from './LanguageSync';

vi.mock('../api/profile', () => ({ saveProfileLanguage: vi.fn() }));

const auth = { user: null };
vi.mock('./useAuth', () => ({ useAuth: () => auth }));

const lang = { language: 'nl' };
vi.mock('../i18n/useLanguage', () => ({ useLanguage: () => lang }));

beforeEach(() => {
  saveProfileLanguage.mockReset().mockResolvedValue({});
  auth.user = null;
  lang.language = 'nl';
});

describe('LanguageSync', () => {
  it('does nothing for a visitor who is not signed in', () => {
    render(<LanguageSync />);
    expect(saveProfileLanguage).not.toHaveBeenCalled();
  });

  it('does nothing when the account already has the site language', () => {
    auth.user = { id: 1, language: 'nl' };
    render(<LanguageSync />);
    expect(saveProfileLanguage).not.toHaveBeenCalled();
  });

  it('saves the site language once when it differs', () => {
    auth.user = { id: 1, language: '' };
    lang.language = 'pap';
    const { rerender } = render(<LanguageSync />);
    rerender(<LanguageSync />);

    expect(saveProfileLanguage).toHaveBeenCalledTimes(1);
    expect(saveProfileLanguage).toHaveBeenCalledWith('pap');
  });

  it('saves again when the customer switches language', () => {
    auth.user = { id: 1, language: 'nl' };
    const { rerender } = render(<LanguageSync />);
    lang.language = 'en';
    rerender(<LanguageSync />);

    expect(saveProfileLanguage).toHaveBeenCalledWith('en');
  });
});
