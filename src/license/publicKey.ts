// SurgeSpace licensing settings.
// PUBLIC_KEY: public half of the server's signing key (64 hex). It can only CHECK keys. While it is empty the
// app runs in demo mode, with the licence server's rules running inside the app.
export const PUBLIC_KEY = '';
/** The SurgeSpace licence server (its own Worker, separate from Engineering Workspace's). */
export const LICENCE_API = 'https://lic.engspace.app/surgespace';
export const CONTACT_EMAIL = 'support@engspace.app';
/** Check in with the licence server at most this often (hours). */
export const CHECKIN_HOURS = 20;
