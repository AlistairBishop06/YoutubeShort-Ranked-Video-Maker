# YouTube Shorts Ranking Video Generator

This is a local Next.js app for generating vertical 9:16 ranking videos from TikTok links.

The app lets you:

- Enter or auto-generate a short-form ranking idea.
- Find viral TikTok candidates related to YouTubers, streamers, funny moments, fails, and trending topics.
- Auto-fill 5 ranked clips.
- Download TikTok clips temporarily with `yt-dlp`.
- Generate a vertical Shorts/Reels/TikTok-style MP4 with FFmpeg.
- Start each video with a 5-second high-energy hook before the #5 clip.
- Keep the main title, current rank, clip label, and ranking list on screen.
- Add a thin animated progress bar that resets for each clip.
- Randomize the main hook teaser text so videos do not all open the same way.
- Add generated impact sound effects on the hook and rank reveals.
- Pop in a large temporary rank reveal at the start of each ranked clip.
- Preserve audio from the source clips.
- Generate a copy-paste viral description with emojis and hashtags.
- Auto-generate hookier titles and short clip names for the video overlay.
- Optionally auto-upload the finished MP4 to YouTube.
- Auto-run every 15 minutes to find a new idea, generate a new video, and upload it.
- Schedule daily upload slots like `5am, 7am, 9am, 11am`.
- Save that schedule to GitHub Actions so uploads continue when the browser is closed.

The app is designed for quick “Top 5” style videos, for example:

- `Top 5 KSI Funny Moments`
- `Top 5 Speed Funny Moments`
- `Top 5 CaseOh Funny Moments`
- `Top 5 Streamer Funny Moments`

## Run The App

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## Basic Workflow

1. Click `Find Viral Idea`.
2. Review the candidate TikToks.
3. Keep the selected 5, or choose different candidates.
4. Check the generated title and clip names.
5. Copy the generated description if needed.
6. Click `Generate Video`.
7. The app renders a 5-second hook first, then plays the ranking from #5 to #1.
8. Preview the MP4.
9. Download the finished video.

TikTok clips are downloaded into `.tmp/tiktok-clips` temporarily and cleaned up after generation.

## Smart Highlights And Clip Filtering

The app defaults to `Smart highlights` mode.

In this mode:

1. Short clips play for their actual length instead of being padded with silence.
2. Long clips are capped by `Seconds per clip`.
3. Long clips are analyzed for audio energy, then the highest-energy window is used instead of always starting at `0:00`.
4. TikToks that look like someone else's ranking, compilation, or repost are filtered out before selection.

The opening hook always uses a smart 5-second highlight window so the first few seconds are more likely to grab attention. In browser/manual generation, the hook teases the #1 source clip without showing its rank. In GitHub Actions scheduled generation, the worker tries to use an extra non-ranking TikTok candidate for the hook first, then falls back to the #1 source clip if no extra candidate downloads successfully.

Each generated video also adds:

1. A per-clip progress bar so each segment feels quick to finish.
2. One randomized hook teaser like `#1 IS UNREAL`, `THIS GETS WORSE`, or `CHAT WAS NOT READY`.
3. Generated impact sound effects mixed into the source audio.
4. A large rank reveal flash at the start of each ranked clip.

The candidate finder rejects titles that contain patterns like:

```text
top 5
top 10
ranking
ranked
compilation
best tiktoks
try not to laugh compilation
full video
part 2
reupload
```

It also rejects source TikToks longer than 90 seconds and downranks clips longer than 60 seconds.

Use `Fixed start` only when you specifically want every clip to start at the beginning and use the same fixed duration.

## Auto-Run Every 15 Minutes

The `Auto-run` toggle in the top bar starts a repeating 15-minute loop:

1. Find a fresh viral idea.
2. Insert the generated title and 5 TikTok candidates into the editor.
3. Generate the 1080x1920 MP4.
4. Upload the finished video to YouTube using the generated emoji title, description, and hashtags.
5. Schedule the next run for 15 minutes later.

Turning on `Auto-run` also turns on `Auto-upload`, because the scheduled loop is designed to publish automatically.

Important: the current version runs this loop in the browser. Keep the app open and keep the computer awake. If the browser tab is closed, the automatic cycle stops.

## Daily Upload Schedule

The `Daily schedule` toggle lets you run the same automated workflow at specific local times every day.

Example schedule:

```text
5am, 7am, 9am, 11am
```

You can also use 24-hour times:

```text
05:00, 07:00, 09:00, 11:00
```

When `Daily schedule` is on, the app:

1. Waits until the next scheduled local time.
2. Finds a fresh viral idea.
3. Generates the ranking video.
4. Uploads it to YouTube.
5. Moves to the next scheduled time.
6. Repeats the same schedule every day.

Turning on `Daily schedule` also turns on `Auto-upload`.

Important: this schedule is browser-based in the current version. Keep the app open and the computer awake. For true background scheduling while the browser is closed, move this workflow to a server cron job or a hosted worker.

## Closed-Tab Scheduling With GitHub Actions

The app can save your selected daily upload times into GitHub Actions repository variables. The workflow in `.github/workflows/scheduled-upload.yml` runs every 15 minutes, checks those saved times, and only generates/uploads when the current time matches a scheduled slot.

This means the upload schedule can keep running even when the website tab is closed!

### Setup Checklist

Use this checklist in order. Do not skip ahead.

Official docs:

- GitHub Actions secrets: https://docs.github.com/en/actions/concepts/security/secrets
- GitHub Actions variables: https://docs.github.com/en/actions/learn-github-actions/variables
- GitHub Actions workflow schedules: https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#onschedule
- GitHub personal access tokens: https://github.com/settings/tokens
- Fine-grained GitHub tokens: https://github.com/settings/personal-access-tokens
- Vercel environment variables: https://vercel.com/docs/projects/environment-variables
- Vercel redeployments: https://vercel.com/docs/deployments/managing-deployments

### Step 1: Push This Project To GitHub

1. Open https://github.com/new
2. Repository name: choose something like `ytshort`.
3. Visibility: `Private` is recommended.
4. Do not add a README, `.gitignore`, or license if this project already has those files.
5. Click `Create repository`.
6. In this project folder, connect your local repo to GitHub:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git add .
git commit -m "Add GitHub scheduled uploads"
git push -u origin main
```

If `git remote add origin` says the remote already exists, use:

```bash
git remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Step 2: Deploy The App

You need the app deployed somewhere public so GitHub Actions can call:

```text
https://your-app.vercel.app/api/ideas/find
```

Vercel is the simplest option:

1. Open https://vercel.com/new
2. Sign in with GitHub.
3. Import your `ytshort` repository.
4. Framework preset: `Next.js`.
5. Root directory: leave as the repository root.
6. Click `Deploy`.
7. Wait for the deployment to finish.
8. Copy your deployed URL, for example:

```text
https://ytshort-yourname.vercel.app
```

You will use this URL as `APP_BASE_URL`.

### Step 3: Add YouTube Secrets To GitHub Actions

These secrets are used by the GitHub Actions worker to upload to YouTube when the browser is closed.

1. Open your GitHub repository.
2. Click `Settings`.
3. In the left sidebar, click `Secrets and variables`.
4. Click `Actions`.
5. Click the `Secrets` tab.
6. Click `New repository secret`.
7. Add this secret:

```text
Name: APP_BASE_URL
Secret: https://your-app.vercel.app
```

8. Click `Add secret`.
9. Click `New repository secret` again.
10. Add:

```text
Name: YOUTUBE_CLIENT_ID
Secret: your_google_client_id
```

11. Click `Add secret`.
12. Click `New repository secret` again.
13. Add:

```text
Name: YOUTUBE_CLIENT_SECRET
Secret: your_google_client_secret
```

14. Click `Add secret`.
15. Click `New repository secret` again.
16. Add:

```text
Name: YOUTUBE_REFRESH_TOKEN
Secret: your_google_refresh_token
```

17. Click `Add secret`.

Required GitHub Actions secrets summary:

```text
APP_BASE_URL=https://your-app.vercel.app
YOUTUBE_CLIENT_ID=your_google_client_id
YOUTUBE_CLIENT_SECRET=your_google_client_secret
YOUTUBE_REFRESH_TOKEN=your_google_refresh_token
```

Do not put quotes around the values in GitHub.

### Step 4: Add GitHub Actions Variables

Variables are safe non-secret settings used by the workflow.

1. In your GitHub repository, go to `Settings`.
2. Click `Secrets and variables`.
3. Click `Actions`.
4. Click the `Variables` tab.
5. Click `New repository variable`.
6. Add:

```text
Name: YOUTUBE_PRIVACY_STATUS
Value: private
```

7. Click `Add variable`.
8. Click `New repository variable`.
9. Add:

```text
Name: YOUTUBE_CATEGORY_ID
Value: 24
```

10. Click `Add variable`.
11. Click `New repository variable`.
12. Add:

```text
Name: CLIP_DURATION_SECONDS
Value: 15
```

13. Click `Add variable`.
14. Click `New repository variable`.
15. Add:

```text
Name: CLIP_MODE
Value: smart
```

16. Click `Add variable`.
17. Click `New repository variable`.
18. Add:

```text
Name: UPLOAD_SCHEDULE_WINDOW_MINUTES
Value: 15
```

19. Click `Add variable`.

Recommended variables summary:

```text
YOUTUBE_PRIVACY_STATUS=private
YOUTUBE_CATEGORY_ID=24
CLIP_MODE=smart
CLIP_DURATION_SECONDS=15
UPLOAD_SCHEDULE_WINDOW_MINUTES=15
```

Keep `YOUTUBE_PRIVACY_STATUS=private` until you have tested successfully.

### Step 5: Create A GitHub Token For The App

This token lets the deployed app save your schedule into GitHub repository variables when you click `Save GitHub Schedule`.

Recommended: create a fine-grained token.

1. Open https://github.com/settings/personal-access-tokens
2. Click `Generate new token`.
3. Choose `Fine-grained token`.
4. Token name: `ytshort schedule updater`.
5. Expiration: choose an expiration you are comfortable with.
6. Resource owner: choose your GitHub account.
7. Repository access: choose `Only select repositories`.
8. Select your `ytshort` repository.
9. Under `Repository permissions`, find `Variables`.
10. Set `Variables` to `Read and write`.
11. `Actions: Read and write` is not enough for this API. The GitHub REST endpoints used by the app require the separate `Variables` permission.
12. If GitHub requires `Metadata`, leave it as `Read-only`.
13. Click `Generate token`.
14. Copy the token immediately.

If you prefer a classic token:

1. Open https://github.com/settings/tokens
2. Click `Generate new token`.
3. Choose `Generate new token (classic)`.
4. Give it a clear name like `ytshort schedule updater`.
5. Select repo access for the repository.
6. Generate and copy the token.

Treat this token like a password.

### Step 6: Add Schedule-Saving Env Vars To Vercel

These env vars are for the deployed website, not GitHub Actions.

1. Open https://vercel.com/dashboard
2. Click your project.
3. Click `Settings`.
4. Click `Environment Variables`.
5. Add:

```text
Name: GITHUB_REPOSITORY
Value: YOUR_USERNAME/YOUR_REPO
Environment: Production
```

6. Click `Save`.
7. Add:

```text
Name: GITHUB_SCHEDULE_TOKEN
Value: paste_the_github_token_here
Environment: Production
```

8. Click `Save`.

If you also use Preview deployments, add the same variables to `Preview`.

### Step 7: Add YouTube Env Vars To Vercel Too

These are needed for the normal in-app `Auto-upload` button. GitHub Actions uses GitHub secrets, but the website itself uses Vercel env vars.

In Vercel `Settings` -> `Environment Variables`, add:

```text
YOUTUBE_CLIENT_ID=your_google_client_id
YOUTUBE_CLIENT_SECRET=your_google_client_secret
YOUTUBE_REFRESH_TOKEN=your_google_refresh_token
YOUTUBE_PRIVACY_STATUS=private
YOUTUBE_CATEGORY_ID=24
```

Set each one to `Production`.

### Step 8: Redeploy The Vercel App

Vercel does not apply new production env vars to an already-built deployment.

1. In Vercel, open your project.
2. Click `Deployments`.
3. Find the latest production deployment.
4. Click the three-dot menu.
5. Click `Redeploy`.
6. Wait for it to finish.

After redeploying, open:

```text
https://your-app.vercel.app/api/github/schedule
```

If setup is correct, it should return something like:

```json
{
  "configured": true,
  "missing": []
}
```

If it says `configured: false`, read the `missing` list and fix those env vars in Vercel.

### Step 9: Save Your Schedule From The App

1. Open your deployed app URL.
2. Find `Daily upload times`.
3. Type your schedule, for example:

```text
5am, 7am, 9am, 11am
```

4. Find `GitHub Actions schedule`.
5. Turn on `Run when app is closed`.
6. Click `Save GitHub Schedule`.
7. You should see a saved message.

This creates or updates these GitHub repository variables:

```text
UPLOAD_SCHEDULE_ENABLED=true
UPLOAD_SCHEDULE_TIMES=05:00,07:00,09:00,11:00
UPLOAD_SCHEDULE_TIMEZONE=your_local_timezone
UPLOAD_IDEA_CREATOR_IDS=selected_creator_ids
UPLOAD_IDEA_TITLE_IDS=selected_title_style_ids
```

You do not need to create those variables manually. If they are missing, the app will create them when you click `Save GitHub Schedule`, as long as `GITHUB_SCHEDULE_TOKEN` has the repository `Variables: Read and write` permission.

The `UPLOAD_IDEA_CREATOR_IDS` and `UPLOAD_IDEA_TITLE_IDS` variables come from the `Search filters` checkbox dropdown in the app. GitHub Actions uses them for closed-tab uploads, so scheduled videos follow the same creator and title-style choices you saved.

The workflow also writes this variable after a successful scheduled upload:

```text
LAST_UPLOAD_SLOT=...
```

That prevents duplicate uploads if GitHub Actions runs more than once inside the same scheduled window.

You do not need to create `LAST_UPLOAD_SLOT` manually. If you do create it, leave it blank. The workflow fills it after the first successful scheduled upload.

The workflow also auto-manages this variable:

```text
RECENT_TIKTOK_IDS=...
```

You do not need to create `RECENT_TIKTOK_IDS` manually. It stores recently uploaded TikTok video IDs so future scheduled runs can avoid generating the exact same video when a topic comes up again.

### Step 10: Test The Workflow Manually

Do this before trusting the schedule.

1. Open your GitHub repository.
2. Click `Actions`.
3. Click `Scheduled YouTube Shorts Upload`.
4. Click `Run workflow`.
5. Turn on `Upload immediately, ignoring the saved schedule`.
6. Click the green `Run workflow` button.
7. Click the new workflow run that appears.
8. Open the `upload` job.
9. Watch the logs.

Expected successful log flow:

```text
Manual workflow dispatch requested.
Downloading #1...
Rendering #5...
Rendered ... MB MP4
Uploaded: https://www.youtube.com/watch?v=...
```

If the run succeeds, check your YouTube Studio uploads page:

https://studio.youtube.com/

### Step 11: Confirm Scheduled Runs Are Enabled

1. In GitHub, open your repository.
2. Click `Actions`.
3. Click `Scheduled YouTube Shorts Upload`.
4. Make sure workflows are enabled. If GitHub shows an `Enable workflow` button, click it.
5. Wait until one of your scheduled times.
6. GitHub Actions should start a run within the next 15-minute check window.

Important timing details:

- The workflow checks every 15 minutes.
- GitHub schedule cron runs in UTC, but this app stores your chosen timezone separately.
- GitHub scheduled workflows may run late during busy periods.
- A `5am` slot means the workflow will upload the first time it runs between `5:00` and `5:14` in your saved timezone.

### Local Worker Test

You can test the worker from your computer, but it needs the same env vars.

PowerShell example:

```powershell
$env:APP_BASE_URL="https://your-app.vercel.app"
$env:YOUTUBE_CLIENT_ID="your_google_client_id"
$env:YOUTUBE_CLIENT_SECRET="your_google_client_secret"
$env:YOUTUBE_REFRESH_TOKEN="your_google_refresh_token"
$env:YOUTUBE_PRIVACY_STATUS="private"
$env:UPLOAD_SCHEDULE_ENABLED="true"
$env:UPLOAD_SCHEDULE_TIMES="05:00,07:00,09:00,11:00"
$env:UPLOAD_SCHEDULE_TIMEZONE="Europe/London"
$env:FORCE_UPLOAD="true"
npm run github:upload
```

Set `FORCE_UPLOAD=true` only for testing. It ignores the schedule and uploads immediately.

### Troubleshooting GitHub Scheduling

`GitHub schedule is not configured`

The deployed website is missing:

```text
GITHUB_REPOSITORY
GITHUB_SCHEDULE_TOKEN
```

Add them to Vercel, then redeploy.

`Could not update GitHub variable`

Your `GITHUB_SCHEDULE_TOKEN` does not have permission to write repository variables. Create a fine-grained token with repository `Variables: Read and write`.

`APP_BASE_URL is required`

Add `APP_BASE_URL` as a GitHub Actions secret. It must be your deployed site URL.

`Could not find a viral idea`

The deployed app could not find five TikTok candidates. Try running again, or check that `APP_BASE_URL/api/ideas/find` works in your browser.

`Could not find the bundled yt-dlp downloader binary`

Run `npm ci` locally, or check the GitHub Actions `Install dependencies` step. The workflow should install `youtube-dl-exec` automatically.

`ffmpeg: command not found`

The workflow installs FFmpeg with `sudo apt-get install -y ffmpeg`. If you changed the workflow runner or OS, make sure native FFmpeg is installed.

`invalid_grant`

The YouTube refresh token is invalid or belongs to a different OAuth client. Regenerate the refresh token using the same `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.

`quotaExceeded`

YouTube upload quota is exhausted. Wait for quota reset or request more quota in Google Cloud.

Workflow does not run exactly at the scheduled minute

That is normal. GitHub scheduled workflows are not exact timers. This workflow checks every 15 minutes and uses a 15-minute upload window.

## Auto-Uploading To YouTube

Auto-uploading requires YouTube OAuth credentials. This is because YouTube uploads happen on behalf of your channel, and Google needs permission from that channel.

The app uses the official YouTube Data API `videos.insert` endpoint:

https://developers.google.com/youtube/v3/docs/videos/insert

OAuth docs:

https://developers.google.com/youtube/v3/guides/auth/installed-apps

Google Cloud Console:

https://console.cloud.google.com/

### What You Need

You need these environment variables:

```env
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_PRIVACY_STATUS=private
YOUTUBE_CATEGORY_ID=24
```

`YOUTUBE_PRIVACY_STATUS=private` is recommended while testing.

### Step 1: Create A Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Sign in with the Google account that owns or can access your YouTube channel.
3. Click the project dropdown at the top.
4. Click `New Project`.
5. Name it something like `Shorts Ranking Uploader`.
6. Click `Create`.

### Step 2: Enable The YouTube Data API

1. Open your new project in Google Cloud Console.
2. Go to `APIs & Services`.
3. Click `Library`.
4. Search for `YouTube Data API v3`.
5. Open it.
6. Click `Enable`.

Direct API page:

https://console.cloud.google.com/apis/library/youtube.googleapis.com

### Step 3: Configure OAuth Consent Screen

1. Go to `APIs & Services` → `OAuth consent screen`.
2. Choose `External` unless you are using a Google Workspace internal app.
3. Click `Create`.
4. Fill in:
   - App name: `Shorts Ranking Uploader`
   - User support email: your email
   - Developer contact email: your email
5. Save and continue.
6. On scopes, add this scope:

```text
https://www.googleapis.com/auth/youtube.upload
```

7. Save and continue.
8. Add yourself as a test user.
9. Finish.

Important: If the app is in testing mode, only added test users can authorize it.

### Step 4: Create OAuth Credentials

1. Go to `APIs & Services` → `Credentials`.
2. Click `Create Credentials`.
3. Choose `OAuth client ID`.
4. Application type: `Desktop app`.
5. Name it `Local Shorts Uploader`.
6. Click `Create`.
7. Copy:
   - Client ID
   - Client secret

Put them in a local `.env` file:

```env
YOUTUBE_CLIENT_ID=your_client_id_here
YOUTUBE_CLIENT_SECRET=your_client_secret_here
```

Do not commit `.env`.

### Step 5: Get A Refresh Token

The refresh token is the long-lived token the app uses to upload without making you log in every time.

Run this command from the project folder:

```bash
npx google-oauth-token --client_id YOUR_CLIENT_ID --client_secret YOUR_CLIENT_SECRET --scope https://www.googleapis.com/auth/youtube.upload
```

If that package is unavailable, use Google OAuth Playground instead:

https://developers.google.com/oauthplayground/

OAuth Playground steps:

1. Open https://developers.google.com/oauthplayground/
2. Click the gear icon in the top right.
3. Enable `Use your own OAuth credentials`.
4. Paste your Client ID and Client Secret.
5. In the left scope box, enter:

```text
https://www.googleapis.com/auth/youtube.upload
```

6. Click `Authorize APIs`.
7. Sign in with the YouTube channel account.
8. Approve the permissions.
9. Click `Exchange authorization code for tokens`.
10. Copy the `refresh_token`.

Add it to `.env`:

```env
YOUTUBE_REFRESH_TOKEN=your_refresh_token_here
```

### Step 6: Finish `.env`

Create `.env` in the project root:

```env
YOUTUBE_CLIENT_ID=your_client_id_here
YOUTUBE_CLIENT_SECRET=your_client_secret_here
YOUTUBE_REFRESH_TOKEN=your_refresh_token_here
YOUTUBE_PRIVACY_STATUS=private
YOUTUBE_CATEGORY_ID=24
```

Privacy options:

```text
private
unlisted
public
```

Keep it as `private` until you have tested uploads successfully.

### Step 7: Restart The App

After editing `.env`, restart the dev server:

```bash
npm run dev
```

The `Auto-upload` toggle should now show that upload is configured.

### Step 8: Test Auto-Upload

1. Open the app.
2. Turn on `Auto-upload`.
3. Click `Find Viral Idea`.
4. Generate a video.
5. Wait for the MP4 to finish.
6. The app will upload it to YouTube.
7. A YouTube link will appear after upload.

The upload uses:

- Generated title with emojis.
- Generated description with emojis and hashtags.
- Generated MP4.
- Privacy status from `YOUTUBE_PRIVACY_STATUS`.

### Common Problems

`YouTube upload is not configured`

One or more env vars are missing. Check `.env`.

`invalid_grant`

The refresh token is invalid, expired, or was created for a different client ID/secret. Generate a new refresh token.

`access_denied`

The Google account did not approve the upload scope, or the user is not added as a test user.

`quotaExceeded`

YouTube uploads use API quota. Wait for quota reset or request more quota in Google Cloud.

Upload succeeds but video is private

That is expected if:

```env
YOUTUBE_PRIVACY_STATUS=private
```

Change it to `unlisted` or `public` only when you are ready.

### Security Notes

- Never commit `.env`.
- Never share your refresh token.
- Use `private` uploads while testing.
- If a token leaks, revoke it from your Google account security settings and generate a new one.
