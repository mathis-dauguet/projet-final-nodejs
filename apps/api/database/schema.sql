-- Schéma du carnet de voyage partagé (PostgreSQL).
-- Rejouable : chaque objet est créé seulement s'il n'existe pas.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar_path   VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journeys (
  id          SERIAL PRIMARY KEY,
  author_id   INTEGER      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  summary     TEXT         NOT NULL DEFAULT '',
  cover_path  VARCHAR(255),
  visibility  VARCHAR(10)  NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS steps (
  id          SERIAL PRIMARY KEY,
  journey_id  INTEGER      NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  photo_path  VARCHAR(255),
  position    INTEGER      NOT NULL CHECK (position >= 0),
  step_date   DATE         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id          SERIAL PRIMARY KEY,
  journey_id  INTEGER     NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
  author_id   INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Suppression logique : le commentaire reste attaché au carnet mais n'apparaît plus.
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tags (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS journey_tags (
  journey_id  INTEGER NOT NULL REFERENCES journeys (id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (journey_id, tag_id)
);

-- Index : filtres et tris de la liste des carnets, jointures fréquentes.
CREATE INDEX IF NOT EXISTS journeys_author_idx     ON journeys (author_id);
CREATE INDEX IF NOT EXISTS journeys_visibility_idx ON journeys (visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS journeys_created_at_idx ON journeys (created_at);
-- Recherche plein texte sur le titre et le résumé.
CREATE INDEX IF NOT EXISTS journeys_search_idx
  ON journeys USING GIN (to_tsvector('french', title || ' ' || summary));

CREATE INDEX IF NOT EXISTS steps_journey_position_idx ON steps (journey_id, position);

-- Liste paginée des commentaires d'un carnet, du plus ancien au plus récent.
CREATE INDEX IF NOT EXISTS comments_journey_created_idx
  ON comments (journey_id, created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS journey_tags_tag_idx ON journey_tags (tag_id);
