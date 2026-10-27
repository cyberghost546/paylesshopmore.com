// src/utils/copyText.js
//
// Copies text to the clipboard. Shared by the onboarding tour's address card
// (components/Tutorial/TutorialStep.jsx) and the warehouse address on the
// profile page (pages/Profile/WarehouseAddressCard.jsx).
//
// The modern way first (navigator.clipboard); the old way for older browsers
// and plain-http pages, where navigator.clipboard is missing. Resolves true
// when it worked, false when it did not - it never throws, so a caller only
// has to choose between "Copied!" and "Copy it yourself".

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused: try the old way below.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
