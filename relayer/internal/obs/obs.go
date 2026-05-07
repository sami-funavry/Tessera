// Package obs provides lightweight observability for the Tessera relayer.
// Set SENTRY_DSN in the environment to enable Sentry error capture.
package obs

import (
	"log/slog"
	"os"
	"time"

	"github.com/getsentry/sentry-go"
)

// Init initialises Sentry if SENTRY_DSN is set; otherwise it's a no-op.
// Call once at process startup before any goroutines start.
func Init(release string) {
	dsn := os.Getenv("SENTRY_DSN")
	if dsn == "" {
		slog.Info("obs: SENTRY_DSN not set — error monitoring disabled")
		return
	}
	err := sentry.Init(sentry.ClientOptions{
		Dsn:              dsn,
		Release:          release,
		Environment:      os.Getenv("TESSERA_ENV"),
		TracesSampleRate: 0.1,
	})
	if err != nil {
		slog.Warn("obs: Sentry init failed", "err", err)
		return
	}
	slog.Info("obs: Sentry error monitoring enabled", "release", release)
}

// Flush flushes buffered events before process exit (2 s timeout).
func Flush() {
	sentry.Flush(2 * time.Second)
}

// CaptureError sends err to Sentry (no-op if Sentry is not initialised).
func CaptureError(err error, tags map[string]string) {
	if err == nil {
		return
	}
	sentry.WithScope(func(scope *sentry.Scope) {
		for k, v := range tags {
			scope.SetTag(k, v)
		}
		sentry.CaptureException(err)
	})
}

// CaptureMessage sends an informational event to Sentry.
func CaptureMessage(msg string, level sentry.Level, tags map[string]string) {
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(level)
		for k, v := range tags {
			scope.SetTag(k, v)
		}
		sentry.CaptureMessage(msg)
	})
}
