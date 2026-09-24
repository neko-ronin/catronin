# Deploying catronin.com

Static site, built with Vite, deployed to Cloudflare as a static-asset Worker.
Static asset requests on Cloudflare are free and unlimited — no bandwidth bill.

## 1. Build locally

    npm install
    npm run build

Output lands in `dist/`.

## 2. Deploy

    npx wrangler login          # opens a browser, one-time
    npx wrangler deploy

`wrangler.jsonc` already names the Worker `catronin` and points at `./dist`.

## 3. Attach the domain

Cloudflare dashboard → Workers & Pages → `catronin` → Settings → Domains & Routes
→ Add → Custom domain → `catronin.com`.

The zone is already in the account (nameservers dora/rohin.ns.cloudflare.com), so
this is a single click and TLS is issued automatically.

## 4. Iterate

    npm run dev                 # local dev server, hot reload
    npm run build && npx wrangler deploy
