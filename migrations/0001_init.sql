CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);
CREATE INDEX idx_decks_user ON decks(user_id);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  field_names TEXT NOT NULL,
  templates TEXT NOT NULL,
  css TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'standard',
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);
CREATE INDEX idx_models_user ON models(user_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  fields TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  guid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_user_guid ON notes(user_id, guid);
CREATE INDEX idx_notes_user_deck ON notes(user_id, deck_id);
CREATE INDEX idx_notes_user_model ON notes(user_id, model_id);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  template_ord INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cards_user_due ON cards(user_id, due);
CREATE INDEX idx_cards_user_note ON cards(user_id, note_id);
CREATE INDEX idx_cards_user_deck ON cards(user_id, deck_id);

CREATE TABLE revlog (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  review_time INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_revlog_user_card ON revlog(user_id, card_id);

CREATE TABLE enrichments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, note_id, kind)
);
CREATE INDEX idx_enrichments_user_note ON enrichments(user_id, note_id);
