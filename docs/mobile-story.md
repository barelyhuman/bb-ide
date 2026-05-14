# Mobile Story

## Goal

Real-user testing should support this workflow:

1. Start bb on a trusted desktop, laptop, or workstation.
2. Put that machine and the phone on the same Tailscale tailnet.
3. Open the bb web app from the phone and use it as a control surface for
   existing projects, threads, and connected hosts.

The phone does not run a bb host daemon. It is a browser client for a bb server
running elsewhere.

## Recommended setup

Install and sign in to Tailscale on both devices. Tailscale assigns devices a
stable `100.x.y.z` address and, when MagicDNS is enabled, a device name that can
be used instead of the IP address:

- Tailscale device connectivity:
  <https://tailscale.com/docs/how-to/connect-to-devices>
- Tailscale MagicDNS:
  <https://tailscale.com/docs/features/magicdns>

On the bb host machine, start bb with the URL that phones should use:

```bash
BB_APP_URL=http://<machine>.<tailnet>.ts.net:38886 pnpm start
```

Then open the same URL on the phone:

```text
http://<machine>.<tailnet>.ts.net:38886
```

Using the Tailscale IP also works:

```text
http://<tailscale-ip>:38886
```

`BB_APP_URL` is not required for same-origin API calls, but it is required for
non-localhost browser origins in flows such as cloud auth. Setting it up front
keeps the mobile URL, generated links, and allowed origins aligned.

## Optional HTTPS

Plain HTTP is enough for the main app and WebSocket flow over a private tailnet.
Some browser features, such as microphone capture for voice input and clipboard
APIs, may require a secure context on mobile browsers.

For HTTPS inside the tailnet, use Tailscale Serve as a reverse proxy to bb:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:38886
BB_APP_URL=https://<machine>.<tailnet>.ts.net pnpm start
```

Tailscale Serve reference:
<https://tailscale.com/docs/reference/tailscale-cli/serve>

## What should work on mobile

- Viewing projects, threads, messages, command output, and file changes.
- Sending prompts, follow-ups, stop requests, approvals, and other server-backed
  thread actions.
- Starting work in an existing project when that project already has a
  connected host source.
- Selecting a connected host or managed worktree from the environment picker
  when the project has a source configured for that host.

## Current gaps

- First-run project creation from a phone is blocked. The app currently creates
  local-path projects through the browser's local daemon probe at
  `localhost:<host-daemon-port>`. On a phone, `localhost` is the phone, not the
  bb host, so the home view shows "No local daemon". Create at least one project
  from the host machine or CLI before testing mobile.
- Native local actions do not target the remote bb host. Folder picking, local
  path existence probes, and "open in editor" go through the browser-local host
  daemon API. On mobile, there is no daemon, so these actions are unavailable.
- Remote host source management is not first-class in the app. If a project
  needs to run on another persistent host, add that host's source through the
  CLI or an app session running on that host.
- bb has no built-in user authentication on the server surface today. Treat
  Tailscale ACLs as the access boundary and do not expose the bb port through
  Tailscale Funnel or the public internet for real-user testing.
- Mobile layout has not been certified as a support gate. The app has responsive
  primitives, but real testing should still include phone-width smoke coverage
  for thread reading, prompt submission, environment selection, approvals, and
  settings.

## Smoke test

1. Start bb with `BB_APP_URL` set to the URL the phone will use.
2. Open `/health` from the phone; it should return `{"ok":true}`.
3. Open the app URL from the phone and confirm the project list loads.
4. Open an existing project with a connected host source.
5. Send a short prompt and verify the thread updates live.
6. Put the phone on cellular while Tailscale remains connected and verify the
   same thread still receives updates.
