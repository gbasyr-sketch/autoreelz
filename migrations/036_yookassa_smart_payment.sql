-- New attempts may let YooKassa choose the payment method. Existing request snapshots stay immutable.
ALTER TABLE ar_payments DROP CONSTRAINT ar_payments_method_check;
ALTER TABLE ar_payments ADD CONSTRAINT ar_payments_method_check CHECK(method IN('card','sbp','smart'));
ALTER TABLE ar_payments DROP CONSTRAINT ar_payment_yoo_snapshot;
ALTER TABLE ar_payments ADD CONSTRAINT ar_payment_yoo_snapshot CHECK(
 (provider='simulation' AND method IN('card','sbp')) OR
 (provider_shop_id IS NOT NULL AND provider_return_url IS NOT NULL AND
  ((provider='yookassa-sandbox' AND method IN('card','smart')) OR
   (provider='yookassa-live' AND method IN('card','sbp','smart') AND receipt_snapshot IS NOT NULL))));
