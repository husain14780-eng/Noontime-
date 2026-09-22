# Make NOOR & TIME live on your domain

This package is a static website and is ready to upload to a static host.

## Important
A domain cannot be registered or attached from the website files alone. You need:
1. A domain you own (for example `yourstore.com`).
2. A static hosting provider (Netlify, Cloudflare Pages, Vercel, GitHub Pages, or your current hosting).
3. The host's custom-domain screen to connect the domain and show the DNS records to add.

## If your host gives you a DNS record
Usually you will add the exact `A`, `AAAA`, or `CNAME` record shown by your host at your domain registrar. Do not guess the value.

## Supabase
Your frontend is already connected to the Supabase project. The Supabase API URL does not change when you attach your own website domain.

## Before launch
- Upload the contents of this folder to your static host.
- Open the live URL.
- Owner login: verify it works.
- Add one product with an image.
- Place one small test COD order.
- Check that the order appears in Owner → Orders and stock decreases.
- Delete/cancel the test order as appropriate.

If you send me the exact domain name and tell me where you are uploading (Netlify, Hostinger, cPanel, Cloudflare Pages, Vercel, GitHub Pages, etc.), I can give you the exact DNS records and final domain setup steps.
