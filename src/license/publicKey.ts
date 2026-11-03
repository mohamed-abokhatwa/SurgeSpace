// SurgeSpace licensing settings.
// PUBLIC_KEY: public half of the server's signing key (64 hex). It can only CHECK keys. While it is empty the
// app runs in demo mode, with the licence server's rules running inside the app.
export const PUBLIC_KEY = '447d3bb533a22d81b3cd8e7855a1f7b63b6f519b6f66e265a07690a0b3aa5226';
/** The SurgeSpace licence server (its own Worker, database and hostname, separate from Engineering Workspace's). */
export const LICENCE_API = 'https://surgespace-licences.engspace.app';
export const CONTACT_EMAIL = 'support@engspace.app';
/** Check in with the licence server at most this often (hours). */
export const CHECKIN_HOURS = 20;
