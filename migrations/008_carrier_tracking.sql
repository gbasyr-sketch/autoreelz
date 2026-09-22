-- Keep the carrier's latest valid tracking number while a manual override is active.
ALTER TABLE ar_orders ADD COLUMN carrier_tracking_number text;
