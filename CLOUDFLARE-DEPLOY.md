# NOOR & TIME — Cloudflare Pages Direct Upload

This package is prepared for Cloudflare Pages **Direct Upload**.

## One-click style deployment

1. Open Cloudflare Dashboard → **Workers & Pages**.
2. Choose **Create application → Pages → Direct Upload / Drag and drop**.
3. Name the project `noor-time` (or another available name).
4. Upload this ZIP file directly. Cloudflare Pages accepts a ZIP for dashboard drag-and-drop deployment.
5. Click **Deploy site**.
6. Your site will receive a free `https://<project-name>.pages.dev` address.

No build command is required. This is a plain static website.

## Important

- Keep the ZIP's files at the archive root; do not upload a folder containing another folder.
- The Supabase publishable browser key is already configured in `config.js`.
- Never replace it with a Supabase service-role/secret key.
- For later updates, use **Create a new deployment** and upload the updated ZIP.

## Custom domain later

Cloudflare Pages can attach a domain you own from the project's **Custom domains** section. If you only want a free address, keep using the supplied `pages.dev` address.

## Before accepting real orders

1. Log in through Owner.
2. Add one test product.
3. Place a test COD order from a second browser/incognito window.
4. Confirm the order appears in Owner → Orders.
5. Confirm stock decreases.
6. Cancel/delete the test data as appropriate.
