/**
 * Weatherwave — backend reference integration
 * -------------------------------------------
 * This is server-side code (Node/Express). It must NOT run in a browser —
 * it holds your Spotify Client Secret and your OpenWeatherMap key.
 *
 * Setup:
 *   npm install express node-fetch dotenv
 *   Create a .env file (never commit this) with:
 *     SPOTIFY_CLIENT_ID=your_client_id
 *     SPOTIFY_CLIENT_SECRET=your_client_secret
 *     OPENWEATHER_API_KEY=your_openweather_key
 *
 * Run:
 *   node backend-integration.js
 *   Then your frontend (the prototype artifact) calls YOUR server's
 *   endpoints below — never Spotify or OpenWeather directly from the browser.
 */

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// 1. Spotify: Client Credentials Flow
//    Good for pulling public playlist/track data — no user login required.
//    Token expires ~1 hour; we cache and auto-refresh it.
// ---------------------------------------------------------------------------
let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt) {
    return spotifyToken;
  }

  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Spotify auth failed: ${JSON.stringify(data)}`);
  }

  spotifyToken = data.access_token;
  // Refresh a minute early to be safe
  spotifyTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

// Maps our internal weather moods to search terms / curated playlist IDs.
// Swap the search terms for real playlist IDs once you've picked specific
// Spotify playlists you want to feature per mood.
const MOOD_SEARCH_TERMS = {
  sunny: "sunny upbeat feel good",
  rainy: "rainy day lofi chill",
  snow: "snow cozy acoustic",
  storm: "storm intense electronic",
  overcast: "overcast mellow indie",
};

async function getPlaylistsForMood(mood) {
  const token = await getSpotifyToken();
  const query = MOOD_SEARCH_TERMS[mood] || MOOD_SEARCH_TERMS.overcast;

  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(
      query
    )}&type=playlist&limit=5`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Spotify search failed: ${JSON.stringify(data)}`);
  }

  return (data.playlists?.items || []).filter(Boolean).map((pl) => ({
    id: pl.id,
    name: pl.name,
    trackCount: pl.tracks?.total ?? null,
    imageUrl: pl.images?.[0]?.url ?? null,
    externalUrl: pl.external_urls?.spotify ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 2. OpenWeatherMap: current weather by lat/lon
// ---------------------------------------------------------------------------
async function getCurrentWeather(lat, lon) {
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${process.env.OPENWEATHER_API_KEY}`
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Weather fetch failed: ${JSON.stringify(data)}`);
  }
  return data;
}

// Maps OpenWeatherMap's condition codes to our internal mood keys.
// Full code list: https://openweathermap.org/weather-conditions
function weatherCodeToMood(code) {
  if (code >= 200 && code < 300) return "storm";
  if (code >= 300 && code < 600) return "rainy";
  if (code >= 600 && code < 700) return "snow";
  if (code === 800) return "sunny";
  return "overcast";
}

// ---------------------------------------------------------------------------
// 3. Endpoints your frontend actually calls
// ---------------------------------------------------------------------------

// GET /api/weather-playlists?lat=40.7&lon=-74.0
app.get("/api/weather-playlists", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: "lat and lon are required" });
    }

    const weather = await getCurrentWeather(lat, lon);
    const mood = weatherCodeToMood(weather.weather?.[0]?.id);
    const playlists = await getPlaylistsForMood(mood);

    res.json({
      mood,
      tempF: Math.round(weather.main?.temp),
      condition: weather.weather?.[0]?.main,
      playlists,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong fetching weather/playlists" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Weatherwave backend running on port ${PORT}`);
});
