# WhatsApp Forwarder

Forward incoming WhatsApp messages to one group, with a web dashboard to connect your account, choose the destination, and monitor activity.

Built with TypeScript, Baileys, and Fastify. It connects as a linked WhatsApp device and does not require an API token.

## Features

- Pair your WhatsApp account by scanning a QR code in the dashboard or terminal.
- Choose a destination from the groups your account belongs to.
- Forward live messages from private chats, groups, and broadcast lists.
- Send images, videos, and documents again, including captions where available.
- View connection status, forwarding statistics, and logs in the dashboard.
- Remember the session and destination between restarts.
- Reconnect automatically after a connection loss.
- Queue outgoing messages and retry failed sends.

## Getting started

You need Node.js 22 or newer, npm, and a WhatsApp account that belongs to the group you want to forward messages to.

From the project folder:

```sh
npm ci
cp .env.example .env
npm run dev
```

On Windows PowerShell, copy the environment file with `Copy-Item .env.example .env`. If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm`.

1. Open <http://127.0.0.1:3000>.
2. Open **Linked devices** in WhatsApp on your phone and choose **Link a device**.
3. Scan the QR code shown in the dashboard or terminal.
4. Once connected, select a destination group in the dashboard.
5. Receive a new message from another account to check forwarding.

Keep the program running to continue forwarding. Messages received before you select a destination are skipped.

To build and run the compiled program:

```sh
npm run build
npm start
```

Both `npm run dev` and `npm start` load `.env`. Run commands from the project root so session, configuration, and log files use the expected paths.

## How forwarding works

The program processes new, live message notifications from the connected account. Eligible messages are added to a queue and sent to the selected group one at a time.

There is no source-chat allowlist: incoming messages from all eligible chats can reach the destination group. Choose the account and destination with that behavior in mind.

The following are skipped:

- Messages sent by your own account, unless `FORWARD_OWN=1`.
- Messages from the destination group, to prevent forwarding loops.
- WhatsApp status updates and internal protocol messages.
- Messages with no content or chat ID.
- Album headers; their individual images are processed separately.

Images, videos, and documents are downloaded and sent again. Other message types use Baileys' forwarding mechanism. Files with a reported size above 50 MiB are replaced with a text notice, and media downloads time out after two minutes.

## Configuration

Copy [.env.example](.env.example) to `.env` and adjust these settings:

| Variable | Default | Description |
| --- | --- | --- |
| `UI_HOST` | `127.0.0.1` | Address the dashboard listens on. The default restricts access to your computer. |
| `UI_PORT` | `3000` | Dashboard port. The program does not read `PORT`. |
| `LOG_LEVEL` | `info` | Application log level. Use `debug` to see why messages are skipped. |
| `FORWARD_OWN` | `0` | Set to exactly `1` to forward your own messages for testing. Messages from the destination group are still skipped. |

Restart the program after changing `.env`.

## Dashboard and terminal

Use the dashboard to scan the pairing QR code, select or change the destination, check status and logs, or log out.

When running interactively, you can also type these commands in the terminal:

| Command | Action |
| --- | --- |
| `status` | Print the current connection and forwarding status. |
| `destination` | List groups and choose a destination by number. |
| `logout` | Log out the connected WhatsApp account. |

Logging out deletes the saved WhatsApp session. Scan a new QR code to connect again.

## Saved files

The program creates these files and folders as needed:

| Path | Contents |
| --- | --- |
| `auth/` | WhatsApp session credentials used to reconnect without scanning again. |
| `data/config.json` | Saved destination group ID and name. |
| `logs/app.log` | Application logs in JSON format. |
| `logs/baileys.log` | Baileys warnings and errors. |

Keep session credentials and `.env` private. The dashboard has no built-in authentication, so keep the default local address unless you protect remote access. Log files are not automatically rotated.

## Limitations

- Historical messages are not replayed.
- The queue is held in memory, so pending messages are lost when the program stops.
- The queue accepts up to 500 waiting messages; additional messages are dropped when it is full.
- Each queued message gets up to three send attempts. Delivery is not guaranteed to be exactly once.
- Run one instance per WhatsApp session to avoid connection conflicts.
- The program uses Baileys rather than the official WhatsApp Business API.

## Troubleshooting

- **Nothing is forwarded:** check that WhatsApp is connected and a destination is selected. Test with a new message from another account outside the destination group. Set `LOG_LEVEL=debug` to inspect skip reasons.
- **Dashboard does not open:** check `UI_HOST` and `UI_PORT` in `.env`. With the defaults, open <http://127.0.0.1:3000> on the computer running the program.
- **Pairing is required after every restart:** check that `auth/` is preserved and writable, and that you start the program from the same project folder.
- **Connection replaced:** stop other running instances that use the same session.
- **More error details needed:** check terminal output, `logs/app.log`, and `logs/baileys.log`.
