-- Activate only after deploying and verifying instagram-token-renewal.
select cron.schedule('instagram-token-renewal','17 * * * *','select public.enqueue_instagram_refresh(false);');
