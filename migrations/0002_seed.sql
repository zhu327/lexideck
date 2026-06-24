INSERT INTO decks (id, user_id, name, created_at)
VALUES ('deck-default-local', 'local', 'Default', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

INSERT INTO models (id, user_id, name, field_names, templates, css, type, created_at)
VALUES (
  'model-basic-local',
  'local',
  'Basic',
  '["Front","Back"]',
  '{"Card 1": {"Front": "{{Front}}", "Back": "{{Back}}"}}',
  '',
  'standard',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
