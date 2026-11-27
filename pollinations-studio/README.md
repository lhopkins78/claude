# Pollinations Studio

A small web app for prompting [Pollinations](https://gen.pollinations.ai/docs) image and video models,
with uploads for image-to-image and image-to-video.

The Node server holds your `sk_` key and proxies four things: the model list, media uploads
(to `media.pollinations.ai`), generation requests (sent as async jobs), and job status and results.
The key never reaches the browser. There are no npm dependencies; Node 20.12+ is enough.

## Run locally

```bash
cp .env.example .env   # then put your sk_ key in POLLINATIONS_KEY
npm start              # http://localhost:3000
```

## Deploy

Set `POLLINATIONS_KEY`, and set `APP_PASSWORD` so strangers can't spend your balance
(the browser will ask for it; any username works).

- **Render:** open https://render.com/deploy?repo=https://github.com/lhopkins78/claude/tree/claude/charming-ritchie-823d6w (or New → Blueprint on this repo). The root `render.yaml` sets up a free web service and asks for the two variables.
- **Docker anywhere** (Fly.io, Railway, Cloud Run…): `docker build -t pollinations-studio . && docker run -p 3000:3000 -e POLLINATIONS_KEY=sk_... -e APP_PASSWORD=... pollinations-studio`
