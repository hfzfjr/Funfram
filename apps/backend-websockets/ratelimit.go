package main

import (
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"
)

type slidingWindowBucket struct {
	mu         sync.Mutex
	timestamps []time.Time
	limit      int
	window     time.Duration
}

func newSlidingWindowBucket(limit int, window time.Duration) *slidingWindowBucket {
	return &slidingWindowBucket{
		timestamps: make([]time.Time, 0, limit),
		limit:      limit,
		window:     window,
	}
}

func (b *slidingWindowBucket) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-b.window)

	idx := 0
	for idx < len(b.timestamps) && b.timestamps[idx].Before(cutoff) {
		idx++
	}
	if idx > 0 {
		b.timestamps = append(b.timestamps[:0], b.timestamps[idx:]...)
	}
	if len(b.timestamps) >= b.limit {
		return false
	}
	b.timestamps = append(b.timestamps, now)
	return true
}

type ConnRateLimiter struct {
	chat    *slidingWindowBucket
	canvas  *slidingWindowBucket
	control *slidingWindowBucket
	report  *slidingWindowBucket
}

func NewConnRateLimiter() *ConnRateLimiter {
	return &ConnRateLimiter{
		chat:    newSlidingWindowBucket(5, 10*time.Second),
		canvas:  newSlidingWindowBucket(60, time.Second),
		control: newSlidingWindowBucket(15, 10*time.Second),
		report:  newSlidingWindowBucket(1, 5*time.Second),
	}
}

type IPRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*slidingWindowBucket
	limit   int
	window  time.Duration
}

func NewIPRateLimiter(limit int, window time.Duration) *IPRateLimiter {
	return &IPRateLimiter{
		buckets: make(map[string]*slidingWindowBucket),
		limit:   limit,
		window:  window,
	}
}

func (l *IPRateLimiter) Allow(ip string) bool {
	l.mu.Lock()
	if len(l.buckets) > 10000 {
		// Simple bounded eviction when map grows large
		for k := range l.buckets {
			delete(l.buckets, k)
			if len(l.buckets) <= 5000 {
				break
			}
		}
	}
	b, ok := l.buckets[ip]
	if !ok {
		b = newSlidingWindowBucket(l.limit, l.window)
		l.buckets[ip] = b
	}
	l.mu.Unlock()
	return b.Allow()
}

func ExtractClientIP(r *http.Request) string {
	if cfIP := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cfIP != "" {
		return cfIP
	}
	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		return realIP
	}
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func CheckWSOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	allowedRaw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))

	if origin == "" {
		// Allow non-browser health/dev clients only in development
		return appEnv == "development" || appEnv == "test" || (appEnv == "" && allowedRaw == "")
	}

	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}

	if appEnv == "development" || appEnv == "test" || (appEnv == "" && allowedRaw == "") {
		hostname := strings.ToLower(parsed.Hostname())
		if hostname == "localhost" || hostname == "127.0.0.1" {
			return true
		}
	}

	if allowedRaw != "" {
		for _, allowed := range strings.Split(allowedRaw, ",") {
			a := strings.TrimRight(strings.TrimSpace(allowed), "/")
			if a != "" && strings.EqualFold(origin, a) {
				return true
			}
		}
		return false
	}

	// Fallback if APP_ENV is not explicitly production and ALLOWED_ORIGINS is empty: match request Host
	if r.Host != "" && strings.EqualFold(parsed.Host, r.Host) {
		return true
	}
	return false
}

func SanitizeText(s string, maxRunes int) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\r' || r == '\n' || r == '\t' || unicode.IsControl(r) {
			if r == '\n' || r == '\t' {
				b.WriteRune(' ')
			}
			continue
		}
		// Strip zero-width & bidi override characters
		if r == '\u200B' || r == '\u200C' || r == '\u200D' || r == '\uFEFF' || (r >= '\u202A' && r <= '\u202E') {
			continue
		}
		b.WriteRune(r)
	}
	cleaned := strings.TrimSpace(b.String())
	if maxRunes > 0 {
		runes := []rune(cleaned)
		if len(runes) > maxRunes {
			cleaned = strings.TrimSpace(string(runes[:maxRunes]))
		}
	}
	return cleaned
}

func IsAllowedGameType(gameType string) bool {
	switch gameType {
	case "guess_drawing", "uno", "chess", "ludo":
		return true
	default:
		return false
	}
}

func IsAllowedReportReason(reason string) bool {
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "nsfw", "inappropriate", "harassment", "underage", "spam", "hate_speech", "other",
		"konten dewasa", "pelecehan", "di bawah umur", "lainnya":
		return true
	default:
		return false
	}
}
