// src/components/ChatAssistant/bookingBridge.js
//
// How the chat types answers into the booking form, which lives on another
// part of the page (or on a page that is not open yet).
//
// The booking page connects itself while it is on screen. When the chat
// fills the form before the page is open, the answers wait here, and the page
// picks them up as soon as it connects - so "help me book" can open /booking
// and fill it in one go.

let fillForm = null;
let waiting = null;

/**
 * Called by the booking page. `fill` receives an object of field -> value.
 * Returns the function that disconnects it again (for useEffect's cleanup).
 */
export function connectBookingForm(fill) {
  fillForm = fill;
  if (waiting) {
    fill(waiting);
    waiting = null;
  }
  return () => {
    if (fillForm === fill) fillForm = null;
  };
}

/** Called by the chat. True when the form was on screen and is filled now. */
export function fillBookingForm(fields) {
  if (fillForm) {
    fillForm(fields);
    return true;
  }
  // Merged, so two fills in a row before the page opens both count.
  waiting = { ...waiting, ...fields };
  return false;
}
