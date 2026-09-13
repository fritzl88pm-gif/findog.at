export const MAINTENANCE_ENV_VAR = "FINDOG_MAINTENANCE_MODE";

export const MAINTENANCE_MESSAGE =
  "Findog/Fred wird gerade gewartet. Bitte versuche es später noch einmal.";

export const MAINTENANCE_RETRY_AFTER_SECONDS = 300;

const ENABLED_MAINTENANCE_VALUES = new Set(["1", "true", "on"]);

export function parseMaintenanceMode(value: string | undefined): boolean {
  return value !== undefined && ENABLED_MAINTENANCE_VALUES.has(value.trim().toLowerCase());
}

export function isMaintenanceModeEnabled(): boolean {
  return parseMaintenanceMode(process.env[MAINTENANCE_ENV_VAR]);
}

export function buildMaintenanceHtml(): string {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Findog/Fred</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      * { box-sizing: border-box; }

      body {
        display: grid;
        min-height: 100dvh;
        place-items: center;
        margin: 0;
        padding: 24px;
        color: #f4f7f9;
        background:
          radial-gradient(circle at 50% 18%, rgba(255, 132, 0, 0.13), transparent 42%),
          linear-gradient(160deg, #10202b 0%, #122734 48%, #0d1821 100%);
      }

      main {
        display: grid;
        justify-items: center;
        max-width: 560px;
        text-align: center;
      }

      img {
        width: min(78vw, 320px);
        height: auto;
        margin-bottom: 12px;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.8rem, 6vw, 2.6rem);
        letter-spacing: -0.02em;
        line-height: 1.1;
      }

      .accent {
        display: block;
        width: 64px;
        height: 4px;
        margin: 18px auto 20px;
        border-radius: 999px;
        background: #ff8400;
      }

      p {
        max-width: 44ch;
        margin: 0;
        color: #b9c6cf;
        font-size: clamp(1rem, 3.2vw, 1.125rem);
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <img src="/fred-maintenance.png" width="1254" height="1254" alt="Findog-Maskottchen Fred im Wartungsmodus">
      <h1>Wir sind gleich wieder da.</h1>
      <span class="accent" aria-hidden="true"></span>
      <p>${MAINTENANCE_MESSAGE}</p>
    </main>
  </body>
</html>`;
}
