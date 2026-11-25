use std::io::SeekFrom;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub struct MediaServer {
    port: u16,
    token: String,
    cache_dir: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ByteRangeResult {
    Valid { start: u64, end: u64 },
    Unsatisfiable,
    Invalid,
}

impl MediaServer {
    pub async fn start(cache_dir: PathBuf) -> Result<Self, std::io::Error> {
        tokio::fs::create_dir_all(&cache_dir).await?;
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let token = Uuid::new_v4().simple().to_string();

        let server_token = token.clone();
        let server_cache_dir = cache_dir.clone();
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let conn_token = server_token.clone();
                        let conn_cache_dir = server_cache_dir.clone();
                        tokio::spawn(async move {
                            let _ = handle_connection(stream, &conn_token, &conn_cache_dir).await;
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            port,
            token,
            cache_dir,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn cache_dir(&self) -> &PathBuf {
        &self.cache_dir
    }

    pub fn stream_url(&self, filename: &str) -> String {
        format!(
            "http://127.0.0.1:{}/media/{}/{}",
            self.port, self.token, filename
        )
    }
}

pub fn is_valid_media_filename(name: &str) -> bool {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }

    let id_part = if let Some(stem) = name.strip_suffix("_480p.mp4") {
        stem
    } else if let Some(stem) = name.strip_suffix("_720p.mp4") {
        stem
    } else if let Some(stem) = name.strip_suffix("_1080p.mp4") {
        stem
    } else {
        return false;
    };

    id_part.len() == 11
        && id_part
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn parse_byte_range(range_header: &str, total_len: u64) -> ByteRangeResult {
    let trimmed = range_header.trim();
    if trimmed.len() < 6 || !trimmed[..6].eq_ignore_ascii_case("bytes=") {
        return ByteRangeResult::Invalid;
    }

    let spec = trimmed[6..].trim();
    if spec.is_empty() || spec.contains(',') {
        return ByteRangeResult::Invalid;
    }

    let Some((start_str, end_str)) = spec.split_once('-') else {
        return ByteRangeResult::Invalid;
    };

    let start_str = start_str.trim();
    let end_str = end_str.trim();

    if start_str.is_empty() && end_str.is_empty() {
        return ByteRangeResult::Invalid;
    }

    if start_str.is_empty() {
        let Ok(suffix) = end_str.parse::<u64>() else {
            return ByteRangeResult::Invalid;
        };
        if suffix == 0 || total_len == 0 {
            return ByteRangeResult::Unsatisfiable;
        }
        let start = total_len.saturating_sub(suffix);
        return ByteRangeResult::Valid {
            start,
            end: total_len - 1,
        };
    }

    let Ok(start) = start_str.parse::<u64>() else {
        return ByteRangeResult::Invalid;
    };

    if end_str.is_empty() {
        if total_len == 0 || start >= total_len {
            return ByteRangeResult::Unsatisfiable;
        }
        return ByteRangeResult::Valid {
            start,
            end: total_len - 1,
        };
    }

    let Ok(end) = end_str.parse::<u64>() else {
        return ByteRangeResult::Invalid;
    };

    if start > end {
        return ByteRangeResult::Invalid;
    }

    if total_len == 0 || start >= total_len {
        return ByteRangeResult::Unsatisfiable;
    }

    ByteRangeResult::Valid {
        start,
        end: end.min(total_len - 1),
    }
}

fn is_disconnect_error(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
    )
}

async fn write_simple_response(
    stream: &mut TcpStream,
    status: &str,
    extra_headers: &str,
) -> Result<(), std::io::Error> {
    let response = format!(
        "HTTP/1.1 {status}\r\n{extra_headers}Content-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await
}

async fn handle_connection(
    mut stream: TcpStream,
    expected_token: &str,
    cache_dir: &PathBuf,
) -> Result<(), std::io::Error> {
    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    let first_bytes = reader.read_line(&mut request_line).await?;
    if first_bytes == 0 || first_bytes > MAX_HEADER_BYTES {
        return Ok(());
    }

    let mut total_header_bytes = first_bytes;
    let mut range_header: Option<String> = None;

    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        total_header_bytes += n;
        if total_header_bytes > MAX_HEADER_BYTES {
            let stream = reader.into_inner();
            return write_simple_response(stream, "431 Request Header Fields Too Large", "").await;
        }
        let trimmed = line.trim_end_matches(&['\r', '\n'][..]);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, val)) = trimmed.split_once(':') {
            if name.trim().eq_ignore_ascii_case("range") {
                range_header = Some(val.trim().to_string());
            }
        }
    }

    let stream = reader.into_inner();

    let mut parts = request_line.split_whitespace();
    let Some(method) = parts.next() else {
        return write_simple_response(stream, "400 Bad Request", "").await;
    };
    let Some(raw_target) = parts.next() else {
        return write_simple_response(stream, "400 Bad Request", "").await;
    };

    if method != "GET" && method != "HEAD" {
        return write_simple_response(stream, "405 Method Not Allowed", "Allow: GET, HEAD\r\n")
            .await;
    }

    let path = raw_target.split('?').next().unwrap_or(raw_target);
    let Some(rest) = path.strip_prefix("/media/") else {
        return write_simple_response(stream, "404 Not Found", "").await;
    };
    let Some((req_token, filename)) = rest.split_once('/') else {
        return write_simple_response(stream, "404 Not Found", "").await;
    };

    if req_token != expected_token {
        return write_simple_response(stream, "403 Forbidden", "").await;
    }

    if !is_valid_media_filename(filename) {
        return write_simple_response(stream, "404 Not Found", "").await;
    }

    let file_path = cache_dir.join(filename);
    let mut file = match File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => return write_simple_response(stream, "404 Not Found", "").await,
    };

    let total_len = file.metadata().await?.len();

    let (status_line, start, chunk_len, content_range_header) = match range_header
        .as_deref()
        .map(|h| parse_byte_range(h, total_len))
    {
        Some(ByteRangeResult::Valid { start, end }) => {
            let len = end - start + 1;
            (
                "206 Partial Content",
                start,
                len,
                format!("Content-Range: bytes {start}-{end}/{total_len}\r\n"),
            )
        }
        Some(ByteRangeResult::Unsatisfiable) => {
            let extra = format!("Content-Range: bytes */{total_len}\r\n");
            return write_simple_response(stream, "416 Range Not Satisfiable", &extra).await;
        }
        Some(ByteRangeResult::Invalid) | None => {
            ("200 OK", 0, total_len, String::new())
        }
    };

    let headers = format!(
        "HTTP/1.1 {status_line}\r\n\
         Content-Type: video/mp4\r\n\
         Accept-Ranges: bytes\r\n\
         {content_range_header}\
         Content-Length: {chunk_len}\r\n\
         Cache-Control: private, max-age=3600\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\r\n"
    );

    if let Err(err) = stream.write_all(headers.as_bytes()).await {
        if is_disconnect_error(&err) {
            return Ok(());
        }
        return Err(err);
    }

    if method == "GET" && chunk_len > 0 {
        file.seek(SeekFrom::Start(start)).await?;
        let mut limited = file.take(chunk_len);
        if let Err(err) = tokio::io::copy(&mut limited, stream).await {
            if is_disconnect_error(&err) {
                return Ok(());
            }
            return Err(err);
        }
    }

    if let Err(err) = stream.flush().await {
        if !is_disconnect_error(&err) {
            return Err(err);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validates_media_filenames_strictly() {
        assert!(is_valid_media_filename("dQw4w9WgXcQ_480p.mp4"));
        assert!(is_valid_media_filename("abcDEF_12-3_720p.mp4"));
        assert!(is_valid_media_filename("0123456789A_1080p.mp4"));

        assert!(!is_valid_media_filename("../dQw4w9WgXcQ_720p.mp4"));
        assert!(!is_valid_media_filename("sub/dQw4w9WgXcQ_720p.mp4"));
        assert!(!is_valid_media_filename("dQw4w9WgXcQ_360p.mp4"));
        assert!(!is_valid_media_filename("short_720p.mp4"));
        assert!(!is_valid_media_filename("dQw4w9WgXcQ_720p.mkv"));
    }

    #[test]
    fn parses_byte_ranges_correctly() {
        assert_eq!(
            parse_byte_range("bytes=0-99", 1000),
            ByteRangeResult::Valid { start: 0, end: 99 }
        );
        assert_eq!(
            parse_byte_range("bytes=50-", 1000),
            ByteRangeResult::Valid {
                start: 50,
                end: 999
            }
        );
        assert_eq!(
            parse_byte_range("bytes=-10", 1000),
            ByteRangeResult::Valid {
                start: 990,
                end: 999
            }
        );
        assert_eq!(
            parse_byte_range("bytes=900-5000", 1000),
            ByteRangeResult::Valid {
                start: 900,
                end: 999
            }
        );
        assert_eq!(
            parse_byte_range("bytes=500-600", 500),
            ByteRangeResult::Unsatisfiable
        );
        assert_eq!(
            parse_byte_range("bytes=10-5", 1000),
            ByteRangeResult::Invalid
        );
        assert_eq!(
            parse_byte_range("items=0-10", 1000),
            ByteRangeResult::Invalid
        );
        assert_eq!(
            parse_byte_range("bytes=0-10, 20-30", 1000),
            ByteRangeResult::Invalid
        );
    }

    async fn raw_http_request(port: u16, req: &str) -> (String, Vec<u8>) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.unwrap();

        let split_pos = buf
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .expect("HTTP response should contain header separator");
        let headers = String::from_utf8_lossy(&buf[..split_pos]).into_owned();
        let body = buf[split_pos + 4..].to_vec();
        (headers, body)
    }

    #[tokio::test]
    async fn serves_full_and_partial_206_content_over_localhost() {
        let dir = tempdir().unwrap();
        let filename = "dQw4w9WgXcQ_720p.mp4";
        let payload: Vec<u8> = (0u32..1024).map(|i| (i % 251) as u8).collect();
        tokio::fs::write(dir.path().join(filename), &payload)
            .await
            .unwrap();

        let server = MediaServer::start(dir.path().to_path_buf()).await.unwrap();
        let port = server.port();
        let token = server.token().to_string();

        // 1. Full GET -> 200 OK
        let (headers, body) = raw_http_request(
            port,
            &format!("GET /media/{token}/{filename} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        )
        .await;
        assert!(headers.starts_with("HTTP/1.1 200 OK"));
        assert!(headers.contains("Accept-Ranges: bytes"));
        assert!(headers.contains("Cache-Control: private, max-age=3600"));
        assert!(headers.contains("Content-Length: 1024"));
        assert_eq!(body, payload);

        // 2. HEAD -> 200 OK with empty body
        let (headers, body) = raw_http_request(
            port,
            &format!("HEAD /media/{token}/{filename} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        )
        .await;
        assert!(headers.starts_with("HTTP/1.1 200 OK"));
        assert!(headers.contains("Content-Length: 1024"));
        assert!(body.is_empty());

        // 3. Partial Range -> 206 Partial Content
        let (headers, body) = raw_http_request(
            port,
            &format!(
                "GET /media/{token}/{filename} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=100-199\r\n\r\n"
            ),
        )
        .await;
        assert!(headers.starts_with("HTTP/1.1 206 Partial Content"));
        assert!(headers.contains("Content-Range: bytes 100-199/1024"));
        assert!(headers.contains("Content-Length: 100"));
        assert_eq!(body, &payload[100..200]);

        // 4. Unsatisfiable Range -> 416
        let (headers, body) = raw_http_request(
            port,
            &format!(
                "GET /media/{token}/{filename} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=2000-2500\r\n\r\n"
            ),
        )
        .await;
        assert!(headers.starts_with("HTTP/1.1 416 Range Not Satisfiable"));
        assert!(headers.contains("Content-Range: bytes */1024"));
        assert!(body.is_empty());

        // 5. Wrong token -> 403
        let (headers, _) = raw_http_request(
            port,
            &format!("GET /media/wrongtoken/{filename} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        )
        .await;
        assert!(headers.starts_with("HTTP/1.1 403 Forbidden"));

        // 6. Traversal filename -> 404
        let (headers, _) = raw_http_request(
            port,
            &format!("GET /media/{token}/../secret.mp4 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        )
        .await;
        assert!(headers.starts_with("HTTP/1.1 404 Not Found"));
    }
}
