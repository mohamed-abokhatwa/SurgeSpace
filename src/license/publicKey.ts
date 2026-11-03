// Public half of the SurgeSpace signing key (64 hex characters). It can only CHECK activation codes.
// Create the key pair once in the licence tool (tools/licence-tool.html), keep the private key file safe,
// and paste the public key here. While this is empty the app runs in demo mode (codes made inside the app).
export const PUBLIC_KEY = '';

// Where users send their Machine ID.
export const LICENCE_EMAIL = 'licence@engspace.app';

// Periodic online check. Upload the status file from the licence tool to this address (it must allow
// cross-origin reads: header "Access-Control-Allow-Origin: *"). Leave empty to turn the online check off.
export const STATUS_URL = 'https://lic.engspace.app/surgespace/status.txt';
/** Check online every this many days, when there is an internet connection. */
export const CHECK_EVERY_DAYS = 3;
/** Keep working this many days without a successful online check, then fall back to Free until it connects. */
export const OFFLINE_DAYS = 30;
