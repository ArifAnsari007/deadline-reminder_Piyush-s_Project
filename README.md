# Deadline Reminder

Simple Node + Express deadline reminder with SSE-based notifications and frontend UI.

## Quick start (local)

1. Install dependencies:
   - npm install
2. Start the server:
   - npm start
3. Open in your browser:
   - http://localhost:3000
4. Allow notifications when prompted and add a future deadline.

## GitHub & Deploy

To host this project on GitHub:

1. Create a new repository on GitHub (via web or `gh repo create`).
2. Locally:
   - git init
   - git add .
   - git commit -m "Initial commit"
   - git branch -M main
   - git remote add origin https://github.com/<your-user>/<your-repo>.git
   - git push -u origin main

### Deploying (recommended options)

- **Render** or **Railway**: connect your GitHub repo and create a new web service; Render/Railway will build and run `npm install` and `npm start` automatically.
- **Heroku**: use the included `Procfile` (web: node server.js); `git push heroku main` will deploy.

**Important:** This app stores tasks in `tasks.json` on the server's filesystem. For production reliability, use a managed database (Postgres) or a proper storage solution—file storage may be ephemeral depending on host.

## GitHub Actions (CI)

A simple CI workflow is included that installs dependencies, starts the server in background, and checks `/health` to make sure the server comes up. See `.github/workflows/ci.yml`.

## Configuration

- `PORT` env var is respected. The default is 3000.

## Want me to push to GitHub for you?
I can create the repo and push the code if you give me the repository name and confirm you want me to proceed (you'll need to provide a GitHub remote or use the GitHub CLI). Alternatively I can guide you step-by-step.
