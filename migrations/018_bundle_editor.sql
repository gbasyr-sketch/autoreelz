-- Owner manager publishes bundle composition through the existing authenticated editor.
-- Physical SKU/stock tables keep their existing permissions and transaction rules.
GRANT INSERT,DELETE ON ar_bundle_components TO ar_app;
