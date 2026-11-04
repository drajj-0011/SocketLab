# Socketlab

A small HTTP/1.1 server written from scratch in C++17 with standard operating-system TCP sockets (Winsock on Windows, POSIX sockets on Linux/macOS). No Express, Flask, or HTTP server libraries. It serves the included React interface and exposes three JSON API routes.

## Requirements

- Windows (MinGW-w64 g++), Linux, or macOS with a C++17 compiler
- Node.js and npm for building the interface

## Run on Windows (PowerShell)

From the project folder, with MinGW-w64 `g++` available in your PATH:

```powershell
npm install
npm run build
g++ -std=c++17 -Wall -Wextra -Wpedantic -O2 server/main.cpp -o socketlab.exe -lws2_32
.\socketlab.exe 8080
```

The `-lws2_32` flag links the Windows socket library. In PowerShell, run the resulting executable as `.\socketlab.exe`, not `./socketlab`. If `g++` is from a Unix-like environment such as WSL instead, use the Linux instructions inside that environment.

## Run on Linux or macOS

```bash
npm install
npm run build
cmake -S . -B build
cmake --build build
./build/socketlab 8080
```

Open `http://localhost:8080`. The first argument changes the port; an optional second argument changes the web root (defaults to `dist`). For frontend-only development, run `npm run dev`. The playground clearly indicates demo mode when it is not connected to the C++ server.

If CMake is not installed, compile the same server directly:

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic -O2 server/main.cpp -o socketlab
./socketlab 8080
```

## Try the API

```bash
curl -i http://localhost:8080/api/health
curl -i http://localhost:8080/api/time
curl -i -X POST http://localhost:8080/api/echo -H 'Content-Type: text/plain' -d 'Hello, sockets!'
```

| Route | Result |
| --- | --- |
| `GET /api/health` | Status, uptime, and request count |
| `GET /api/time` | Current UTC time |
| `POST /api/echo` | Echoed request body and byte count |

The server reads request headers and `Content-Length` bodies, returns explicit HTTP status lines and headers, serves the single-file Vite build at `/` and `/index.html`, blocks directory traversal, caps headers at 16 KiB and bodies at 1 MiB, and closes each connection after one request. It is intentionally single-threaded and does not implement TLS, chunked transfer encoding, or persistent connections. Use it as a learning project, not as a production-facing server.

## Troubleshooting on Windows

- If `vite is not recognized`, install the frontend dependencies in this project folder with `npm install --include=dev`, then run `npm run build` again. Vite is a development dependency and is not installed when npm is configured to omit dev dependencies.
- If `g++` cannot find a standard C++ header, check `g++ --version`. The server no longer requires `<filesystem>`, but an older or incomplete MinGW installation may still need updating to a current MinGW-w64 compiler.
- Run one command at a time. If compilation fails, `socketlab.exe` will not exist yet, so do not run the last command until the build succeeds.