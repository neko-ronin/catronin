# Deploying catronin.com

Static site, built with Vite, deployed to Cloudflare as a static-asset Worker.
Static asset requests on Cloudflare are free and unlimited — no bandwidth bill.

`wrangler` and `vite` are local devDependencies. There is no global install and there
does not need to be one: `npm run <script>` puts `node_modules/.bin` on PATH for you.

## 1. Install

    npm install

## 2. Build

    npm run build

Output lands in `dist/`.

## 3. Authenticate (once)

    npm run login

Opens a browser for Cloudflare OAuth. Nothing else needs configuring.

## 4. Deploy

    npm run deploy          # builds, then uploads dist/ to the Worker named catronin

Dry-run first if you want to see what would be uploaded without touching production:

    npx wrangler deploy --dry-run

## 5. Attach the domain

Cloudflare dashboard → Workers & Pages → `catronin` → Settings → Domains & Routes
→ Add → Custom domain → `catronin.com`.

The zone is already in the account (nameservers dora/rohin.ns.cloudflare.com), so this
is a single click and TLS is issued automatically.

## 6. Iterate

    npm run dev             # local dev server with hot reload
    npm run build && npm run deploy

## Notes

- `wrangler.jsonc` sets `assets.directory = "./dist"` and `not_found_handling =
  "404-page"`. There is no Worker script; Cloudflare serves the assets directly.
- Pages-per-file limit is 25 MiB. Anything larger (heavy meshes, HDRIs) belongs in R2:
  10 GB free, zero egress fees.
- Bundle is ~535 kB / ~133 kB gzipped, almost entirely three.js core.
