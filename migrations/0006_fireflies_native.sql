-- Fireflies connects natively (OAuth against its MCP server), so unlike the
-- Composio providers we DO hold its grant — envelope-encrypted, same as every
-- other credential. `sealed` stays null for Composio-vaulted providers.

alter table notetakers add column sealed text;
