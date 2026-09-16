/**
 * config.js
 * Single place to point the gallery at an image source.
 *
 * Swap PROVIDER to "api" and set API_ENDPOINT to move from the static
 * data/images.json file to a live backend (e.g. your own server that
 * proxies Unsplash/Pexels). Never put a secret API key in this file —
 * frontend JS is public. A real key belongs on a server you control,
 * behind API_ENDPOINT.
 */
const CONFIG = {
  // "local"  -> reads data/images.json (default, no backend needed)
  // "api"    -> fetches API_ENDPOINT, which must return the same shape
  //             as images.json: { categories: [...], images: [...] }
  PROVIDER: "local",

  LOCAL_DATA_URL: "data/images.json",
  API_ENDPOINT: "/api/images", // used only when PROVIDER === "api"

  // How many cards to render per page/scroll batch.
  PAGE_SIZE: 18,

  // Local storage keys (namespaced so this app never collides with others).
  STORAGE: {
    SEEN: "gm_seen_ids",
    FAVORITES: "gm_favorites",
    DOWNLOADS: "gm_downloads",
    LAST_VISIT: "gm_last_visit_date",
    DAY_QUEUE: "gm_day_queue",
    CYCLE: "gm_cycle_count",
  },
};
