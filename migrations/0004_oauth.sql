-- Subscription tokens are short-lived, so the refresh token has to be stored
-- alongside the access token or the product works for an hour and then quietly
-- stops — which reads to a user as "it broke", not "sign in again".
--
-- `sealed` now holds an envelope over a JSON blob {accessToken, refreshToken}
-- rather than a bare string. `expires_at` is plaintext on purpose: it carries no
-- secret and being able to see "expired" without decrypting is worth more.

alter table connections add column expires_at text;
