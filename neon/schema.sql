-- ============================================================
-- Euro Collection — schema completo da zero per Neon (Postgres)
-- Esegui tutto nel Neon Console → SQL Editor → Run.
-- Auth: tabella public.users (una riga per dispositivo, senza password).
-- Sessione: cookie dispositivo httpOnly (lib/auth.ts), nessun
-- componente DB. I controlli "solo proprietario / solo amici"
-- sono applicati nelle query/funzioni con user_id esplicito.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 0) Utenti
-- password_hash NULL = utente senza password (riservato a OAuth futuro).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON public.users (lower(email));

-- ------------------------------------------------------------
-- Funzione shared: aggiorna updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 1) Collezione privata: una riga per (utente, moneta)
-- coin_id = ID stabile del catalogo (lib/catalog.ts)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_collection (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  coin_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  grade text CHECK (grade IS NULL OR grade IN ('FDC', 'SPL', 'BB', 'MB', 'B')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, coin_id)
);
CREATE INDEX IF NOT EXISTS idx_user_collection_user
  ON public.user_collection (user_id);
DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.user_collection;
CREATE TRIGGER trg_touch_updated_at
  BEFORE UPDATE ON public.user_collection
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- 2) Possesso per singolo anno ("tutti gli anni")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_collection_years (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  coin_id text NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 1999 AND 2100),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  grade text CHECK (grade IS NULL OR grade IN ('FDC', 'SPL', 'BB', 'MB', 'B')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, coin_id, year)
);
CREATE INDEX IF NOT EXISTS idx_user_collection_years_user
  ON public.user_collection_years (user_id);
CREATE INDEX IF NOT EXISTS idx_user_collection_years_coin
  ON public.user_collection_years (user_id, coin_id);
DROP TRIGGER IF EXISTS trg_touch_years_updated_at ON public.user_collection_years;
CREATE TRIGGER trg_touch_years_updated_at
  BEFORE UPDATE ON public.user_collection_years
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- 3) Profili pubblici
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar text,
  country char(2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, split_part(coalesce(NEW.email, 'collezionista'), '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_user_created ON public.users;
CREATE TRIGGER on_user_created
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- 4) Amicizie
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id),
  UNIQUE (requester_id, addressee_id)
);
DROP TRIGGER IF EXISTS trg_touch_friendships_updated_at ON public.friendships;
CREATE TRIGGER trg_touch_friendships_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.is_friend(a uuid, b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = a AND addressee_id = b)
        OR (requester_id = b AND addressee_id = a))
  );
$$;

-- ------------------------------------------------------------
-- 5) Offerte di scambio
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trade_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  coin_id text NOT NULL,
  year integer CHECK (year IS NULL OR (year BETWEEN 1999 AND 2100)),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  grade text CHECK (grade IS NULL OR grade IN ('FDC', 'SPL', 'BB', 'MB', 'B')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_offers_user_coin_year
  ON public.trade_offers (user_id, coin_id, coalesce(year, -1));
DROP TRIGGER IF EXISTS trg_touch_offers_updated_at ON public.trade_offers;
CREATE TRIGGER trg_touch_offers_updated_at
  BEFORE UPDATE ON public.trade_offers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- 6) Richieste di scambio: pending -> accepted -> completed
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  offered_offer_id uuid REFERENCES public.trade_offers (id) ON DELETE SET NULL,
  requested_offer_id uuid REFERENCES public.trade_offers (id) ON DELETE SET NULL,
  offered_coin_id text NOT NULL,
  offered_year integer,
  requested_coin_id text NOT NULL,
  requested_year integer,
  accepted_offered_year integer,
  accepted_requested_year integer,
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proposer_id <> addressee_id)
);
DROP TRIGGER IF EXISTS trg_touch_requests_updated_at ON public.trade_requests;
CREATE TRIGGER trg_touch_requests_updated_at
  BEFORE UPDATE ON public.trade_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- 7) Funzioni scambio (con p_actor_id esplicito)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_one_unit(
  p_giver uuid, p_receiver uuid, p_coin text, p_year int
)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year int := p_year;
  v_qty int;
BEGIN
  IF v_year IS NULL THEN
    SELECT year INTO v_year FROM public.user_collection_years
    WHERE user_id = p_giver AND coin_id = p_coin AND quantity > 0
    ORDER BY quantity DESC, year ASC LIMIT 1;
  END IF;

  -- ATTENZIONE al vincolo CHECK (quantity > 0) di entrambe le tabelle:
  -- "decrementa e poi cancella" NON funziona, perché l'UPDATE che porta la
  -- quantità a 0 viola il CHECK prima che la DELETE venga eseguita. Perciò si
  -- decrementa solo la riga con quantity > 1 e, quando è l'ultimo pezzo, si
  -- cancella la riga senza mai scrivere 0.
  IF v_year IS NOT NULL THEN
    UPDATE public.user_collection_years SET quantity = quantity - 1
    WHERE user_id = p_giver AND coin_id = p_coin AND year = v_year
      AND quantity > 1
    RETURNING quantity INTO v_qty;

    IF NOT FOUND THEN
      DELETE FROM public.user_collection_years
      WHERE user_id = p_giver AND coin_id = p_coin AND year = v_year;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
    END IF;

    INSERT INTO public.user_collection_years (user_id, coin_id, year, quantity)
    VALUES (p_receiver, p_coin, v_year, 1)
    ON CONFLICT (user_id, coin_id, year)
    DO UPDATE SET quantity = public.user_collection_years.quantity + 1;
  END IF;

  -- Riga principale: un pezzo in meno al donatore e uno in più al destinatario,
  -- con la stessa accortezza. Non si riscrive la quantità come somma degli anni:
  -- quella somma ignora i pezzi segnati solo nella riga principale (pulsante +)
  -- e azzererebbe i doppioni già posseduti dal destinatario.
  UPDATE public.user_collection SET quantity = quantity - 1
  WHERE user_id = p_giver AND coin_id = p_coin AND quantity > 1
  RETURNING quantity INTO v_qty;

  IF NOT FOUND THEN
    DELETE FROM public.user_collection
    WHERE user_id = p_giver AND coin_id = p_coin;
    -- Nessuna riga principale: è un errore solo se non c'è nemmeno l'anno
    -- tracciato (cioè il donatore non possiede affatto quel pezzo).
    IF NOT FOUND AND v_year IS NULL THEN RAISE EXCEPTION 'NOT_OWNED'; END IF;
  END IF;

  INSERT INTO public.user_collection (user_id, coin_id, quantity)
  VALUES (p_receiver, p_coin, 1)
  ON CONFLICT (user_id, coin_id)
  DO UPDATE SET quantity = public.user_collection.quantity + 1;

  RETURN v_year;
END $$;

CREATE OR REPLACE FUNCTION public.accept_trade_request(p_request_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.trade_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.trade_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.addressee_id <> p_actor_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'STATE'; END IF;

  UPDATE public.trade_requests
  SET status = 'accepted'
  WHERE id = p_request_id;
END $$;

CREATE OR REPLACE FUNCTION public.complete_trade_request(p_request_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.trade_requests%ROWTYPE;
  v_offered record;
  v_requested record;
  v_offered_year int;
  v_requested_year int;
BEGIN
  SELECT * INTO r FROM public.trade_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.proposer_id <> p_actor_id AND r.addressee_id <> p_actor_id THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF r.status <> 'accepted' THEN RAISE EXCEPTION 'STATE'; END IF;

  SELECT * INTO v_offered FROM public.trade_offers
  WHERE id = r.offered_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offered.quantity < 1 THEN
    RAISE EXCEPTION 'OFFER_UNAVAILABLE';
  END IF;
  SELECT * INTO v_requested FROM public.trade_offers
  WHERE id = r.requested_offer_id FOR UPDATE;
  IF NOT FOUND OR v_requested.quantity < 1 THEN
    RAISE EXCEPTION 'OFFER_UNAVAILABLE';
  END IF;

  v_offered_year := public.move_one_unit(
    r.proposer_id, r.addressee_id, r.offered_coin_id, r.offered_year);
  v_requested_year := public.move_one_unit(
    r.addressee_id, r.proposer_id, r.requested_coin_id, r.requested_year);

  -- Un'unità è stata scambiata: l'offerta si scala di uno e sparisce quando
  -- era l'ultima disponibile. Il decremento è condizionato a quantity > 1 e
  -- l'offerta esaurita si cancella: scrivere 0 violerebbe il CHECK
  -- (trade_offers_quantity_check) prima della DELETE.
  UPDATE public.trade_offers SET quantity = quantity - 1
  WHERE id = r.offered_offer_id AND quantity > 1;
  DELETE FROM public.trade_offers
  WHERE id = r.offered_offer_id AND quantity <= 1;
  UPDATE public.trade_offers SET quantity = quantity - 1
  WHERE id = r.requested_offer_id AND quantity > 1;
  DELETE FROM public.trade_offers
  WHERE id = r.requested_offer_id AND quantity <= 1;

  UPDATE public.trade_requests
  SET status = 'completed',
      accepted_offered_year = v_offered_year,
      accepted_requested_year = v_requested_year
  WHERE id = p_request_id;
END $$;
