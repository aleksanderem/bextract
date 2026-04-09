# bextract

API do pobierania danych salonów z Booksy. Wywołuje wewnętrzne API Booksy używając `x-api-key` przechwyconego z XHR requestów strony. Gdy klucz wygaśnie (403), automatycznie pobiera świeży przez Browserless.io — bez logowania, bez captchy.

## Wymagania

- Node.js 20+
- Konto [Browserless.io](https://www.browserless.io/) (do odświeżania klucza)

## Instalacja

```bash
git clone git@github.com:aleksanderem/bextract.git
cd bextract
npm install
cp .env.example .env
# uzupełnij BROWSERLESS_TOKEN w .env
```

## Konfiguracja

Plik `.env`:

```
BROWSERLESS_TOKEN=your_browserless_token
API_KEY=your_api_key
PORT=3000
```

`API_KEY` — klucz wymagany w nagłówku `x-api-key` każdego requestu. Bez niego serwer nie wystartuje.

## Użycie

### Start serwera

```bash
npm start
```

Przy pierwszym uruchomieniu (brak `.credentials.json`) serwer automatycznie łączy się z Browserless, odwiedza booksy.com i przechwytuje `x-api-key` z XHR. Kolejne uruchomienia używają zapisanego klucza.

### Endpointy

#### `GET /api/salon/:id`

Pobiera dane salonu po ID.

```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3000/api/salon/100080
```

Response: pełny obiekt business z API Booksy (nazwa, adres, telefon, email, recenzje, personel, usługi, godziny otwarcia itd.)

#### `GET /api/salon/:id/reviews?page=1&per_page=10`

Pobiera paginowane recenzje salonu.

```bash
curl -H "x-api-key: YOUR_API_KEY" "http://localhost:3000/api/salon/100080/reviews?page=1&per_page=50"
```

Query params:
- `page` (alias: `reviews_page`) — numer strony, domyślnie 1
- `per_page` (alias: `reviews_per_page`) — ile recenzji na stronę, 1–50, domyślnie 10

Response:

```json
{
  "reviews": [
    {
      "id": 16039032,
      "rank": 5,
      "review": "Super! 🤩👌",
      "title": "",
      "verified": true,
      "appointment_date": "2026-04-08T10:00",
      "created": "2026-04-08T14:08",
      "reply_content": "Dziękujemy za opinię 🫶",
      "reply_updated": "2026-04-08T21:04",
      "user": { "id": 9544910, "first_name": "Klaudia", "last_name": "W…" },
      "services": [{ "id": 2018529, "name": "Uzupełnienie żel/hybryda jeden kolor" }],
      "staff": [{ "id": 375575, "name": "Olga 30% Rabat" }],
      "photos": [],
      "business": { "id": 36993, "name": "Barber SHOP & Tattoo Studio" }
    }
  ],
  "reviews_count": 2362,
  "reviews_rank": 4.86,
  "reviews_stars": 5,
  "reviews_page": 1,
  "reviews_per_page": 50,
  "num_reviews_per_rank": { "1": 52, "2": 18, "3": 16, "4": 37, "5": 2239 },
  "filtered_reviews_count": 2362
}
```

Rate limit: callers powinni zachowac ~500ms odstep miedzy requestami, zeby nie wpasc w rate limiting Booksy.

#### `GET /api/salon?url=<booksy_url>`

Pobiera dane salonu po URL strony Booksy. ID jest wyciągane automatycznie.

```bash
curl "http://localhost:3000/api/salon?url=https://booksy.com/pl-pl/d/nazwa-salonu/100080"
```

#### `GET /api/auth/status`

Sprawdza czy klucz API jest aktywny.

```bash
curl http://localhost:3000/api/auth/status
```

```json
{
  "active": true,
  "apiKey": "web-...",
  "capturedAt": "2026-04-01T20:00:00.000Z"
}
```

#### `POST /api/auth/refresh`

Wymusza odświeżenie klucza przez Browserless.

```bash
curl -X POST http://localhost:3000/api/auth/refresh
```

### Ręczne odświeżenie klucza

```bash
npm run refresh
```

## Jak to działa

1. Normalny request → bezpośredni HTTP do `pl.booksy.com/core/v2/customer_api/businesses/:id/` z zapisanym `x-api-key`. Zero Browserless, zero kosztów.

2. Klucz wygasł (403) → automatycznie jedno połączenie do Browserless, wizyta na booksy.com, przechwycenie nowego `x-api-key` z network requests, zapis do `.credentials.json`, retry oryginalnego requestu.

## Struktura

```
server.js    — Express API
auth.js      — odświeżanie x-api-key przez Browserless
client.js    — HTTP client do Booksy API z auto-retry
store.js     — persystencja credentials w .credentials.json
refresh.js   — CLI do ręcznego odświeżenia klucza
```

## Format odpowiedzi

Endpoint `/api/salon/:id` zwraca surowy response z API Booksy:

```json
{
  "business": {
    "id": 100080,
    "name": "...",
    "slug": "...",
    "description": "...",
    "location": { "lat": ..., "lng": ..., "address": "..." },
    "phone": "...",
    "public_email": "...",
    "reviews_count": 841,
    "reviews_rank": 4.9,
    "staff": [...],
    "service_categories": [...],
    "open_hours": {...},
    "images": [...],
    ...
  },
  "legal_footer_visible": true
}
```

Pełna lista pól obiektu `business`: `id`, `name`, `slug`, `description`, `business_categories`, `location`, `reviews_rank`, `reviews_count`, `reviews_stars`, `reviews`, `phone`, `website`, `public_email`, `staff`, `service_categories`, `open_hours`, `images`, `booking_mode`, `booking_policy`, `amenities`, `top_services`, `instagram_link`, `facebook_link` i inne.
