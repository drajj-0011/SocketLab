#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>
#endif

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <csignal>
#include <climits>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>

#ifdef _WIN32
using Socket = SOCKET;
constexpr Socket INVALID_SOCKET_HANDLE = INVALID_SOCKET;
void close_socket(Socket socket) { closesocket(socket); }
int last_socket_error() { return WSAGetLastError(); }
#else
using Socket = int;
constexpr Socket INVALID_SOCKET_HANDLE = -1;
void close_socket(Socket socket) { close(socket); }
int last_socket_error() { return errno; }
#endif

constexpr std::size_t MAX_HEADERS = 16 * 1024;
constexpr std::size_t MAX_BODY = 1024 * 1024;
const auto started_at = std::chrono::steady_clock::now();
std::size_t request_count = 0;

struct Request {
    std::string method;
    std::string path;
    std::string version;
    std::map<std::string, std::string> headers;
    std::string body;
};

std::string lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

std::string trim(const std::string& value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}

std::string json_escape(const std::string& value) {
    std::ostringstream out;
    for (unsigned char c : value) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (c < 0x20) {
                    out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                        << static_cast<int>(c) << std::dec;
                } else {
                    out << static_cast<char>(c);
                }
        }
    }
    return out.str();
}

bool send_all(Socket client, const std::string& data) {
    std::size_t sent = 0;
    while (sent < data.size()) {
        const auto count = static_cast<int>(std::min(data.size() - sent,
                                                      static_cast<std::size_t>(INT_MAX)));
        const auto n = send(client, data.data() + sent, count, 0);
        if (n <= 0) return false;
        sent += static_cast<std::size_t>(n);
    }
    return true;
}

void respond(Socket client, int status, const std::string& reason,
             const std::string& body, const std::string& content_type,
             bool head = false, const std::string& extra = "") {
    std::ostringstream headers;
    headers << "HTTP/1.1 " << status << ' ' << reason << "\r\n"
            << "Content-Type: " << content_type << "\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Connection: close\r\n"
            << "X-Content-Type-Options: nosniff\r\n"
            << extra << "\r\n";
    send_all(client, headers.str());
    if (!head) send_all(client, body);
}

void error(Socket client, int status, const std::string& reason,
           const std::string& message, const std::string& extra = "") {
    respond(client, status, reason,
            "{\"error\":\"" + json_escape(message) + "\",\"status\":" +
                std::to_string(status) + "}",
            "application/json; charset=utf-8", false, extra);
}

// Read through the header terminator first, then exactly Content-Length bytes.
bool read_request(Socket client, Request& request, int& failure) {
    std::string buffer;
    char chunk[4096];
    std::size_t header_end = std::string::npos;
    while ((header_end = buffer.find("\r\n\r\n")) == std::string::npos) {
        const auto n = recv(client, chunk, static_cast<int>(sizeof(chunk)), 0);
        if (n <= 0) { failure = 400; return false; }
        buffer.append(chunk, static_cast<std::size_t>(n));
        if (buffer.size() > MAX_HEADERS + MAX_BODY) { failure = 413; return false; }
        if (buffer.size() > MAX_HEADERS && buffer.find("\r\n\r\n") == std::string::npos) {
            failure = 431;
            return false;
        }
    }
    if (header_end > MAX_HEADERS) { failure = 431; return false; }

    std::istringstream stream(buffer.substr(0, header_end));
    std::string line;
    if (!std::getline(stream, line)) { failure = 400; return false; }
    std::istringstream first_line(trim(line));
    std::string extra;
    if (!(first_line >> request.method >> request.path >> request.version) ||
        (first_line >> extra) || request.version != "HTTP/1.1") {
        failure = 400;
        return false;
    }
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const auto separator = line.find(':');
        if (separator == std::string::npos) { failure = 400; return false; }
        request.headers[lower(trim(line.substr(0, separator)))] = trim(line.substr(separator + 1));
    }
    if (request.headers.count("transfer-encoding")) { failure = 501; return false; }

    std::size_t length = 0;
    if (request.headers.count("content-length")) {
        try {
            const auto& raw = request.headers.at("content-length");
            std::size_t consumed = 0;
            const auto parsed = std::stoull(raw, &consumed);
            if (consumed != raw.size()) throw std::invalid_argument("invalid length");
            if (parsed > MAX_BODY) { failure = 413; return false; }
            length = static_cast<std::size_t>(parsed);
        } catch (...) { failure = 400; return false; }
    }
    request.body = buffer.substr(header_end + 4);
    if (request.body.size() > length) request.body.resize(length);
    while (request.body.size() < length) {
        const auto n = recv(client, chunk,
                            static_cast<int>(std::min(sizeof(chunk), length - request.body.size())), 0);
        if (n <= 0) { failure = 400; return false; }
        request.body.append(chunk, static_cast<std::size_t>(n));
    }
    return true;
}

bool decode_path(const std::string& raw, std::string& decoded) {
    for (std::size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] == '%') {
            if (i + 2 >= raw.size()) return false;
            const auto hex = raw.substr(i + 1, 2);
            if (hex.find_first_not_of("0123456789abcdefABCDEF") != std::string::npos) return false;
            const char c = static_cast<char>(std::stoi(hex, nullptr, 16));
            if (c == '\0' || c == '\\') return false;
            decoded += c;
            i += 2;
        } else {
            if (raw[i] == '\\' || raw[i] == '\0') return false;
            decoded += raw[i];
        }
    }
    return !decoded.empty() && decoded.front() == '/';
}

void serve_file(Socket client, const std::string& path, const std::string& root, bool head) {
    // The Vite build is a single HTML file. An allowlist avoids filesystem traversal entirely.
    if (path.find("..") != std::string::npos) {
        error(client, 403, "Forbidden", "Path traversal is not allowed");
        return;
    }
    if (path != "/" && path != "/index.html") {
        error(client, 404, "Not Found", "No route matches this path");
        return;
    }
    std::ifstream input(root + "/index.html", std::ios::binary);
    if (!input) { error(client, 500, "Internal Server Error", "Could not read file"); return; }
    const std::string body((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    respond(client, 200, "OK", body, "text/html; charset=utf-8", head);
}

void handle_client(Socket client, const std::string& root) {
    Request request;
    int failure = 0;
    if (!read_request(client, request, failure)) {
        const std::map<int, std::string> reasons = {
            {400, "Bad Request"}, {413, "Payload Too Large"},
            {431, "Request Header Fields Too Large"}, {501, "Not Implemented"}
        };
        error(client, failure, reasons.at(failure), "Could not parse HTTP request");
        return;
    }
    ++request_count;
    std::string path;
    if (!decode_path(request.path.substr(0, request.path.find('?')), path)) {
        error(client, 400, "Bad Request", "Invalid URL path");
        return;
    }
    std::cout << request.method << ' ' << path << std::endl;

    if (path == "/api/health" && request.method == "GET") {
        const auto uptime = std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::steady_clock::now() - started_at).count();
        respond(client, 200, "OK", "{\"status\":\"ok\",\"server\":\"Socketlab\",\"uptime_seconds\":" +
                std::to_string(uptime) + ",\"requests\":" + std::to_string(request_count) + "}",
                "application/json; charset=utf-8");
        return;
    }
    if (path == "/api/time" && request.method == "GET") {
        const auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
        std::tm utc{};
#ifdef _WIN32
        std::tm* tmp_utc = std::gmtime(&now);
if (tmp_utc) utc = *tmp_utc;
#else
        gmtime_r(&now, &utc);
#endif
        std::ostringstream timestamp;
        timestamp << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
        respond(client, 200, "OK", "{\"utc\":\"" + timestamp.str() + "\"}",
                "application/json; charset=utf-8");
        return;
    }
    if (path == "/api/echo" && request.method == "POST") {
        respond(client, 200, "OK", "{\"message\":\"" + json_escape(request.body) +
                "\",\"bytes\":" + std::to_string(request.body.size()) + "}",
                "application/json; charset=utf-8");
        return;
    }
    if (path.rfind("/api/", 0) == 0) {
        if (path == "/api/health" || path == "/api/time" || path == "/api/echo") {
            const auto allowed = path == "/api/echo" ? "POST" : "GET";
            error(client, 405, "Method Not Allowed", "Method not allowed for this route",
                  "Allow: " + std::string(allowed) + "\r\n");
        } else {
            error(client, 404, "Not Found", "No route matches this path");
        }
        return;
    }
    if (request.method != "GET" && request.method != "HEAD") {
        error(client, 405, "Method Not Allowed", "Static files only support GET and HEAD",
              "Allow: GET, HEAD\r\n");
        return;
    }
    serve_file(client, path, root, request.method == "HEAD");
}

int main(int argc, char* argv[]) {
#ifdef _WIN32
    WSADATA winsock_data{};
    if (WSAStartup(MAKEWORD(2, 2), &winsock_data) != 0) {
        std::cerr << "Could not initialize Winsock\n";
        return 1;
    }
#else
    std::signal(SIGPIPE, SIG_IGN);
#endif
    int port = 8080;
    try {
        if (argc > 1) port = std::stoi(argv[1]);
    } catch (...) {
        std::cerr << "Invalid port\n";
        return 1;
    }
    if (port < 1 || port > 65535) {
        std::cerr << "Port must be between 1 and 65535\n";
        return 1;
    }
    const std::string root = argc > 2 ? argv[2] : "dist";
    std::ifstream page(root + "/index.html", std::ios::binary);
    if (!page) {
        std::cerr << "Web page not found: " << root << "/index.html (run npm run build first)\n";
        return 1;
    }
    page.close();

    const Socket server = socket(AF_INET, SOCK_STREAM, 0);
    if (server == INVALID_SOCKET_HANDLE) {
        std::cerr << "socket failed: " << last_socket_error() << '\n';
        return 1;
    }
#ifndef _WIN32
    int reuse = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
#endif
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(static_cast<uint16_t>(port));
    if (bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
        listen(server, 16) != 0) {
        std::cerr << "bind/listen failed: " << last_socket_error() << '\n';
        close_socket(server);
        return 1;
    }
    std::cout << "Socketlab listening on http://localhost:" << port << std::endl;
    while (true) {
        const Socket client = accept(server, nullptr, nullptr);
        if (client == INVALID_SOCKET_HANDLE) {
            std::cerr << "accept failed: " << last_socket_error() << '\n';
            continue;
        }
#ifdef _WIN32
        DWORD timeout = 5000;
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO,
                   reinterpret_cast<const char*>(&timeout), sizeof(timeout));
#else
        timeval timeout{5, 0};
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
#endif
        handle_client(client, root);
        close_socket(client);
    }
    close_socket(server);
#ifdef _WIN32
    WSACleanup();
#endif
}