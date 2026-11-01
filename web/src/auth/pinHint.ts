/** PINs are 4 digits. */
export const PIN_LENGTH = 4;

/**
 * Set on a phone that has a PIN, so the login page opens on the keypad.
 * The key changed when PINs went from 6 to 4 digits: a phone with an old
 * 6-digit PIN opens on the password form and is offered a new PIN after login.
 */
export const PIN_HINT_KEY = 'bmsc_has_pin4';
export const OLD_PIN_HINT_KEY = 'bmsc_has_pin';
