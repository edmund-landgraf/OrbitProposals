-- Slow the live run so a visitor can read each call before the next one starts.
UPDATE "try_me_setting" SET "value" = 1800 WHERE "code" = 'step_delay_ms';
